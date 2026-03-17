import { Job, Worker } from "bullmq";
import { redis } from "./client";
import { resolveWorkerConcurrencyConfig, startQueueAutoscaler } from "./autoscaler";
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
import { logError, logInfo } from "@/lib/observability/logger";
import { recordDeliveryResult, recordQueueLag, recordWorkerThroughput } from "@/lib/observability/metrics";

let worker: Worker<InboundMessageJob> | null = null;
const inboundWorkers = new Map<string, Worker<InboundMessageJob>>();
const outboundWorkers = new Map<string, Worker<OutboundSendJob>>();

function resolveInboundConcurrency() {
    return resolveWorkerConcurrencyConfig({
        envPrefix: "INBOUND_WORKER",
        defaultInitial: 2,
        defaultMaxCap: 16,
    });
}

function resolveOutboundConcurrency() {
    return resolveWorkerConcurrencyConfig({
        envPrefix: "OUTBOUND_WORKER",
        defaultInitial: 1,
        defaultMaxCap: 16,
        defaultTargetBacklog: 10,
    });
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

    startQueueAutoscaler({
        workerType: "whatsapp-inbound",
        queueName: "whatsapp-inbound",
        workerRef: worker,
        config: inbound,
    });

    logInfo("queue.worker.started", {
        queueName: "whatsapp-inbound",
        concurrency: inbound.initial,
        minConcurrency: inbound.min,
        maxConcurrency: inbound.max,
        autoscaleIntervalMs: inbound.intervalMs,
        autoscaleTargetBacklog: inbound.targetBacklog,
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
    startQueueAutoscaler({
        workerType: "whatsapp-inbound",
        queueName,
        workerRef: inboundWorker,
        config: inbound,
    });

    logInfo("queue.worker.started", {
        queueName,
        concurrency: inbound.initial,
        minConcurrency: inbound.min,
        maxConcurrency: inbound.max,
        autoscaleIntervalMs: inbound.intervalMs,
        autoscaleTargetBacklog: inbound.targetBacklog,
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

    const outbound = resolveOutboundConcurrency();

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
            concurrency: outbound.initial,
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
                provider: "whatsapp",
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
    startQueueAutoscaler({
        workerType: "whatsapp-outbound",
        queueName,
        workerRef: outboundWorker,
        config: outbound,
    });
    logInfo("queue.worker.started", {
        queueName,
        concurrency: outbound.initial,
        minConcurrency: outbound.min,
        maxConcurrency: outbound.max,
        autoscaleIntervalMs: outbound.intervalMs,
        autoscaleTargetBacklog: outbound.targetBacklog,
    });
    return outboundWorker;
}

export function getOutboundWorker(queueName?: string) {
    if (queueName) {
        return outboundWorkers.get(queueName) ?? null;
    }

    return outboundWorkers.values().next().value ?? null;
}
