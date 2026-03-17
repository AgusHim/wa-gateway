import os from "os";
import { Queue, type Worker } from "bullmq";
import { logInfo, logWarn } from "../observability/logger";
import { upsertWorkerRuntimeSnapshot } from "../observability/workerRuntime";
import { redis } from "./client";

export type WorkerConcurrencyConfig = {
    initial: number;
    min: number;
    max: number;
    intervalMs: number;
    targetBacklog: number;
};

type ResolveConcurrencyInput = {
    envPrefix: string;
    defaultInitial: number;
    defaultMaxCap?: number;
    defaultIntervalMs?: number;
    defaultTargetBacklog?: number;
};

type QueueAutoscalerInput<T> = {
    workerType: "whatsapp-inbound" | "whatsapp-outbound" | "instagram-webhook";
    queueName: string;
    workerRef: Worker<T>;
    config: WorkerConcurrencyConfig;
};

const globalForAutoscaler = globalThis as typeof globalThis & {
    __waGatewayAutoscalerTimers?: Map<string, NodeJS.Timeout>;
};

const autoscalerTimers = globalForAutoscaler.__waGatewayAutoscalerTimers
    || new Map<string, NodeJS.Timeout>();

if (!globalForAutoscaler.__waGatewayAutoscalerTimers) {
    globalForAutoscaler.__waGatewayAutoscalerTimers = autoscalerTimers;
}

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

export function resolveWorkerConcurrencyConfig(input: ResolveConcurrencyInput): WorkerConcurrencyConfig {
    const cpuBasedMax = Math.max(1, Math.min(input.defaultMaxCap || 16, resolveCpuCount()));
    const min = parseIntEnv(`${input.envPrefix}_MIN_CONCURRENCY`, 1);
    const max = parseIntEnv(`${input.envPrefix}_MAX_CONCURRENCY`, cpuBasedMax);
    const initial = parseIntEnv(
        `${input.envPrefix}_CONCURRENCY`,
        Math.min(max, Math.max(min, input.defaultInitial))
    );
    const intervalMs = parseIntEnv(
        `${input.envPrefix}_AUTOSCALE_INTERVAL_MS`,
        parseIntEnv("WORKER_AUTOSCALE_INTERVAL_MS", input.defaultIntervalMs || 5000)
    );
    const targetBacklog = parseIntEnv(
        `${input.envPrefix}_AUTOSCALE_TARGET_BACKLOG`,
        parseIntEnv("WORKER_AUTOSCALE_TARGET_BACKLOG", input.defaultTargetBacklog || 20)
    );

    return {
        min: Math.max(1, Math.min(min, max)),
        max: Math.max(1, Math.max(min, max)),
        initial: Math.max(1, Math.min(initial, Math.max(min, max))),
        intervalMs: Math.max(1000, intervalMs),
        targetBacklog: Math.max(1, targetBacklog),
    };
}

export function startQueueAutoscaler<T>(input: QueueAutoscalerInput<T>) {
    upsertWorkerRuntimeSnapshot({
        workerType: input.workerType,
        queueName: input.queueName,
        concurrency: input.workerRef.concurrency,
        minConcurrency: input.config.min,
        maxConcurrency: input.config.max,
        targetBacklog: input.config.targetBacklog,
        intervalMs: input.config.intervalMs,
        lastBacklog: 0,
        updatedAt: Date.now(),
    });

    if (autoscalerTimers.has(input.queueName)) {
        return;
    }

    const queue = new Queue<T>(input.queueName, { connection: redis });

    const timer = setInterval(async () => {
        try {
            const counts = await queue.getJobCounts("wait", "active", "delayed");
            const backlog = (counts.wait || 0) + (counts.active || 0) + (counts.delayed || 0);
            const target = Math.max(
                input.config.min,
                Math.min(input.config.max, Math.ceil(backlog / input.config.targetBacklog))
            );

            if (input.workerRef.concurrency !== target) {
                const previous = input.workerRef.concurrency;
                input.workerRef.concurrency = target;
                logInfo("queue.worker.autoscaled", {
                    workerType: input.workerType,
                    queueName: input.queueName,
                    previousConcurrency: previous,
                    nextConcurrency: target,
                    backlog,
                });
            }

            upsertWorkerRuntimeSnapshot({
                workerType: input.workerType,
                queueName: input.queueName,
                concurrency: input.workerRef.concurrency,
                minConcurrency: input.config.min,
                maxConcurrency: input.config.max,
                targetBacklog: input.config.targetBacklog,
                intervalMs: input.config.intervalMs,
                lastBacklog: backlog,
                updatedAt: Date.now(),
            });
        } catch (error) {
            logWarn("queue.worker.autoscaler.failed", {
                workerType: input.workerType,
                queueName: input.queueName,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }, input.config.intervalMs);

    timer.unref?.();
    autoscalerTimers.set(input.queueName, timer);
}
