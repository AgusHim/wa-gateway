import os from "os";
import { Job, Queue, Worker } from "bullmq";
import { redis } from "./client";
import {
    DeadLetterJob,
    InboundMessageJob,
    OutboundSendJob,
    getDefaultOutboundSendQueue,
    getInboundDeadLetterQueue,
    getInboundQueueName,
    getOutboundDeadLetterQueue,
    getOutboundQueueName,
} from "./messageQueue";
import { withObservationContext } from "@/lib/observability/context";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import { recordDeliveryResult, recordQueueLag, recordWorkerThroughput } from "@/lib/observability/metrics";

let worker: Worker<InboundMessageJob> | null = null;
const inboundWorkers = new Map<string, Worker<InboundMessageJob>>();
const outboundWorkers = new Map<string, Worker<OutboundSendJob>>();
const autoscalerByQueue = new Map<string, NodeJS.Timeout>();

function parseIntEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(1, Math.round(parsed));
}

function resolveCpuCount(): number {
    const available = typeof os.availableParallelism === "function" ? os.availableParallelism() : 0;
    if (available > 0) {
        return available;
    }
    return Math.max(1, os.cpus().length || 1);
}

function resolveInboundConcurrency() {
    const cpuBasedMax = Math.max(1, Math.min(16, resolveCpuCount()));
    const min = parseIntEnv("INBOUND_WORKER_MIN_CONCURRENCY", 1);
    const max = parseIntEnv("INBOUND_WORKER_MAX_CONCURRENCY", cpuBasedMax);
    const initial = parseIntEnv("INBOUND_WORKER_CONCURRENCY", Math.min(max, Math.max(min, 2)));

    return {
        min: Math.max(1, Math.min(min, max)),
        max: Math.max(1, Math.max(min, max)),
        initial: Math.max(1, Math.min(initial, Math.max(min, max))),
    };
}

function startAutoscalerForQueue(queueName: string, workerRef: Worker<InboundMessageJob>) {
    if (autoscalerByQueue.has(queueName)) {
        return;
    }

    const { min, max } = resolveInboundConcurrency();
    const intervalMs = parseIntEnv("WORKER_AUTOSCALE_INTERVAL_MS", 5000);
    const targetPerWorker = parseIntEnv("WORKER_AUTOSCALE_TARGET_BACKLOG", 20);
    const queue = new Queue<InboundMessageJob>(queueName, { connection: redis });

    const timer = setInterval(async () => {
        try {
            const counts = await queue.getJobCounts("wait", "active", "delayed");
            const backlog = (counts.wait || 0) + (counts.active || 0) + (counts.delayed || 0);
            const target = Math.max(min, Math.min(max, Math.ceil(backlog / Math.max(1, targetPerWorker))));

            if (workerRef.concurrency !== target) {
                const previous = workerRef.concurrency;
                workerRef.concurrency = target;
                logInfo("queue.worker.autoscaled", {
                    queueName,
                    previousConcurrency: previous,
                    nextConcurrency: target,
                    backlog,
                });
            }
        } catch (error) {
            logWarn("queue.worker.autoscaler.failed", {
                queueName,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }, Math.max(1000, intervalMs));

    timer.unref?.();
    autoscalerByQueue.set(queueName, timer);
}

function isFinalFailure(job: Job<InboundMessageJob> | Job<OutboundSendJob>): boolean {
    const attemptsConfigured = Number(job.opts.attempts ?? 1);
    const attempts = Number.isFinite(attemptsConfigured) ? Math.max(1, attemptsConfigured) : 1;
    return job.attemptsMade >= attempts;
}

function safeQueueLagMs(value: number | undefined): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, value as number);
}

async function enqueueInboundDeadLetter(job: Job<InboundMessageJob>, err: Error) {
    const deadLetterPayload: DeadLetterJob<InboundMessageJob> = {
        sourceQueue: job.queueName,
        originalJobId: job.id ? String(job.id) : undefined,
        failedReason: err.message,
        attemptsMade: job.attemptsMade,
        failedAt: Date.now(),
        workspaceId: job.data.workspaceId,
        channelId: job.data.channelId,
        correlationId: job.data.correlationId,
        traceId: job.data.traceId,
        payload: job.data,
    };

    await getInboundDeadLetterQueue().add(
        `dlq:${job.queueName}:${job.id || "unknown"}:${Date.now()}`,
        deadLetterPayload
    );
}

async function enqueueOutboundDeadLetter(job: Job<OutboundSendJob>, err: Error) {
    const deadLetterPayload: DeadLetterJob<OutboundSendJob> = {
        sourceQueue: job.queueName,
        originalJobId: job.id ? String(job.id) : undefined,
        failedReason: err.message,
        attemptsMade: job.attemptsMade,
        failedAt: Date.now(),
        workspaceId: job.data.workspaceId,
        channelId: job.data.channelId,
        correlationId: job.data.correlationId,
        traceId: job.data.traceId,
        payload: job.data,
    };

    const dlq = getOutboundDeadLetterQueue(job.data.workspaceId, job.data.channelId);
    await dlq.add(
        `dlq:${job.queueName}:${job.id || "unknown"}:${Date.now()}`,
        deadLetterPayload
    );
}

export function startWorker(
    processor: (job: Job<InboundMessageJob>) => Promise<void>
) {
    if (worker) {
        logInfo("queue.worker.already_running", {
            queueName: "whatsapp-inbound",
        });
        return worker;
    }

    const inbound = resolveInboundConcurrency();

    worker = new Worker<InboundMessageJob>(
        "whatsapp-inbound",
        async (job) => withObservationContext({
            correlationId: job.data.correlationId,
            traceId: job.data.traceId,
            workspaceId: job.data.workspaceId,
            channelId: job.data.channelId,
            messageId: job.data.messageId,
            queueName: job.queueName,
            jobId: String(job.id || ""),
            component: "inbound-worker",
        }, async () => {
            const lagMs = safeQueueLagMs(Date.now() - (job.data.enqueuedAt || Date.now()));
            await recordQueueLag({
                queueName: job.queueName,
                workspaceId: job.data.workspaceId,
                channelId: job.data.channelId,
                lagMs,
            });

            logInfo("queue.job.processing", {
                queueName: job.queueName,
                jobId: job.id,
                lagMs,
                phoneNumber: job.data.phoneNumber,
            });

            await processor(job);
        }),
        {
            connection: redis,
            concurrency: inbound.initial,
        }
    );

    worker.on("completed", async (job) => {
        await recordWorkerThroughput({
            queueName: job.queueName,
            workspaceId: job.data.workspaceId,
            channelId: job.data.channelId,
            status: "processed",
        });

        logInfo("queue.job.completed", {
            queueName: job.queueName,
            jobId: job.id,
        });
    });

    worker.on("failed", async (job, err) => {
        if (!job) {
            logError("queue.job.failed_without_job", err);
            return;
        }

        const finalFailure = isFinalFailure(job);

        if (finalFailure) {
            await recordWorkerThroughput({
                queueName: job.queueName,
                workspaceId: job.data.workspaceId,
                channelId: job.data.channelId,
                status: "failed",
            });

            try {
                await enqueueInboundDeadLetter(job, err);
            } catch (dlqError) {
                logError("queue.dlq.enqueue_failed", dlqError, {
                    queueName: job.queueName,
                    jobId: job.id,
                });
            }
        }

        logError("queue.job.failed", err, {
            queueName: job.queueName,
            jobId: job.id,
            attemptsMade: job.attemptsMade,
            finalFailure,
        });
    });

    worker.on("error", (err) => {
        logError("queue.worker.error", err, {
            queueName: "whatsapp-inbound",
        });
    });

    startAutoscalerForQueue("whatsapp-inbound", worker);

    logInfo("queue.worker.started", {
        queueName: "whatsapp-inbound",
        concurrency: inbound.initial,
        minConcurrency: inbound.min,
        maxConcurrency: inbound.max,
    });
    return worker;
}

export function startInboundWorkerForPartition(
    workspaceId: string,
    channelId: string,
    processor: (job: Job<InboundMessageJob>) => Promise<void>
) {
    const queueName = getInboundQueueName(workspaceId, channelId);
    const existing = inboundWorkers.get(queueName);
    if (existing) {
        return existing;
    }

    const inbound = resolveInboundConcurrency();

    const inboundWorker = new Worker<InboundMessageJob>(
        queueName,
        async (job) => withObservationContext({
            correlationId: job.data.correlationId,
            traceId: job.data.traceId,
            workspaceId: job.data.workspaceId,
            channelId: job.data.channelId,
            messageId: job.data.messageId,
            queueName: job.queueName,
            jobId: String(job.id || ""),
            component: "inbound-worker",
        }, async () => {
            const lagMs = safeQueueLagMs(Date.now() - (job.data.enqueuedAt || Date.now()));
            await recordQueueLag({
                queueName: job.queueName,
                workspaceId: job.data.workspaceId,
                channelId: job.data.channelId,
                lagMs,
            });

            logInfo("queue.job.processing", {
                queueName: job.queueName,
                jobId: job.id,
                lagMs,
                phoneNumber: job.data.phoneNumber,
            });

            await processor(job);
        }),
        {
            connection: redis,
            concurrency: inbound.initial,
        }
    );

    inboundWorker.on("completed", async (job) => {
        await recordWorkerThroughput({
            queueName: job.queueName,
            workspaceId: job.data.workspaceId,
            channelId: job.data.channelId,
            status: "processed",
        });

        logInfo("queue.job.completed", {
            queueName: job.queueName,
            jobId: job.id,
        });
    });

    inboundWorker.on("failed", async (job, err) => {
        if (!job) {
            logError("queue.job.failed_without_job", err, { queueName });
            return;
        }

        const finalFailure = isFinalFailure(job);
        if (finalFailure) {
            await recordWorkerThroughput({
                queueName: job.queueName,
                workspaceId: job.data.workspaceId,
                channelId: job.data.channelId,
                status: "failed",
            });

            try {
                await enqueueInboundDeadLetter(job, err);
            } catch (dlqError) {
                logError("queue.dlq.enqueue_failed", dlqError, {
                    queueName: job.queueName,
                    jobId: job.id,
                });
            }
        }

        logError("queue.job.failed", err, {
            queueName: job.queueName,
            jobId: job.id,
            attemptsMade: job.attemptsMade,
            finalFailure,
        });
    });

    inboundWorker.on("error", (err) => {
        logError("queue.worker.error", err, { queueName });
    });

    inboundWorkers.set(queueName, inboundWorker);
    startAutoscalerForQueue(queueName, inboundWorker);

    logInfo("queue.worker.started", {
        queueName,
        concurrency: inbound.initial,
        minConcurrency: inbound.min,
        maxConcurrency: inbound.max,
    });

    return inboundWorker;
}

export function getWorker() {
    return worker;
}

export function getInboundWorker(queueName?: string) {
    if (queueName) {
        return inboundWorkers.get(queueName) ?? null;
    }

    return inboundWorkers.values().next().value ?? worker ?? null;
}

export function startOutboundWorker(
    processor: (job: Job<OutboundSendJob>) => Promise<void>
) {
    const queue = getDefaultOutboundSendQueue();
    return startOutboundWorkerByName(queue.name, processor);
}

export function startOutboundWorkerForPartition(
    workspaceId: string,
    channelId: string,
    processor: (job: Job<OutboundSendJob>) => Promise<void>
) {
    const queueName = getOutboundQueueName(workspaceId, channelId);
    return startOutboundWorkerByName(queueName, processor);
}

function startOutboundWorkerByName(
    queueName: string,
    processor: (job: Job<OutboundSendJob>) => Promise<void>
) {
    const existing = outboundWorkers.get(queueName);
    if (existing) {
        return existing;
    }

    const outboundConcurrency = parseIntEnv("OUTBOUND_WORKER_CONCURRENCY", 1);

    const outboundWorker = new Worker<OutboundSendJob>(
        queueName,
        async (job) => withObservationContext({
            correlationId: job.data.correlationId,
            traceId: job.data.traceId,
            workspaceId: job.data.workspaceId,
            channelId: job.data.channelId,
            messageId: job.data.sourceMessageId,
            queueName: job.queueName,
            jobId: String(job.id || ""),
            component: "outbound-worker",
        }, async () => {
            const lagMs = safeQueueLagMs(Date.now() - (job.data.requestedAt || Date.now()));
            await recordQueueLag({
                queueName: job.queueName,
                workspaceId: job.data.workspaceId,
                channelId: job.data.channelId,
                lagMs,
            });

            logInfo("queue.job.processing", {
                queueName: job.queueName,
                jobId: job.id,
                lagMs,
                phoneNumber: job.data.phoneNumber,
            });

            await processor(job);
        }),
        {
            connection: redis,
            concurrency: Math.max(1, outboundConcurrency),
        }
    );

    outboundWorker.on("completed", async (job) => {
        await recordWorkerThroughput({
            queueName: job.queueName,
            workspaceId: job.data.workspaceId,
            channelId: job.data.channelId,
            status: "processed",
        });

        logInfo("queue.job.completed", {
            queueName: job.queueName,
            jobId: job.id,
        });
    });

    outboundWorker.on("failed", async (job, err) => {
        if (!job) {
            logError("queue.job.failed_without_job", err, { queueName });
            return;
        }

        const finalFailure = isFinalFailure(job);

        if (finalFailure) {
            await recordWorkerThroughput({
                queueName: job.queueName,
                workspaceId: job.data.workspaceId,
                channelId: job.data.channelId,
                status: "failed",
            });
            await recordDeliveryResult({
                workspaceId: job.data.workspaceId,
                channelId: job.data.channelId,
                success: false,
            });

            try {
                await enqueueOutboundDeadLetter(job, err);
            } catch (dlqError) {
                logError("queue.dlq.enqueue_failed", dlqError, {
                    queueName: job.queueName,
                    jobId: job.id,
                });
            }
        }

        logError("queue.job.failed", err, {
            queueName: job.queueName,
            jobId: job.id,
            attemptsMade: job.attemptsMade,
            finalFailure,
        });
    });

    outboundWorker.on("error", (err) => {
        logError("queue.worker.error", err, { queueName });
    });

    outboundWorkers.set(queueName, outboundWorker);
    logInfo("queue.worker.started", {
        queueName,
        concurrency: Math.max(1, outboundConcurrency),
    });
    return outboundWorker;
}

export function getOutboundWorker(queueName?: string) {
    if (queueName) {
        return outboundWorkers.get(queueName) ?? null;
    }

    return outboundWorkers.values().next().value ?? null;
}
