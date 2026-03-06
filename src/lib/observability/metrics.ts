import { redis } from "../queue/client";
import { logWarn } from "./logger";

type WorkerStatus = "processed" | "failed";

type QueueMetricInput = {
    queueName: string;
    workspaceId?: string;
    channelId?: string;
};

type QueueLagInput = QueueMetricInput & {
    lagMs: number;
};

type AiLatencyInput = {
    workspaceId?: string;
    channelId?: string;
    latencyMs: number;
    model?: string;
};

type DeliveryInput = {
    workspaceId?: string;
    channelId?: string;
    success: boolean;
};

export type MetricsSnapshot = {
    windowMinutes: number;
    queueLagAvgMs: number;
    aiLatencyAvgMs: number;
    workerThroughputPerMinute: number;
    deliverySuccessRate: number;
    totals: {
        queueLagSamples: number;
        workerProcessed: number;
        workerFailed: number;
        aiLatencySamples: number;
        deliverySuccess: number;
        deliveryFailed: number;
    };
    queueBreakdown: Array<{
        queueName: string;
        processed: number;
        failed: number;
        lagAvgMs: number;
    }>;
};

const METRIC_PREFIX = "obs:metrics:v1";
const RETENTION_SECONDS = 3 * 24 * 60 * 60;

function floorToMinute(date: Date): Date {
    const output = new Date(date);
    output.setSeconds(0, 0);
    return output;
}

function toBucket(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hour = String(date.getUTCHours()).padStart(2, "0");
    const minute = String(date.getUTCMinutes()).padStart(2, "0");
    return `${year}${month}${day}${hour}${minute}`;
}

function bucketKey(date: Date): string {
    return `${METRIC_PREFIX}:${toBucket(date)}`;
}

function normalizeNumber(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, value);
}

async function bumpMetrics(fields: Record<string, number>): Promise<void> {
    if (Object.keys(fields).length === 0) {
        return;
    }

    const key = bucketKey(new Date());

    try {
        const tx = redis.multi();
        for (const [field, value] of Object.entries(fields)) {
            tx.hincrbyfloat(key, field, value);
        }
        tx.expire(key, RETENTION_SECONDS);
        await tx.exec();
    } catch (error) {
        logWarn("metrics.bump.failed", {
            key,
            fieldCount: Object.keys(fields).length,
            reason: error instanceof Error ? error.message : String(error),
        });
    }
}

function queueMetricPrefix(queueName: string): string {
    return `queue:${queueName}`;
}

export async function recordQueueLag(input: QueueLagInput): Promise<void> {
    const lag = normalizeNumber(input.lagMs);
    const queuePrefix = queueMetricPrefix(input.queueName);
    const fields: Record<string, number> = {
        queue_lag_ms_sum: lag,
        queue_lag_samples: 1,
        [`${queuePrefix}:lag_sum`]: lag,
        [`${queuePrefix}:lag_count`]: 1,
    };

    if (input.workspaceId) {
        fields[`workspace:${input.workspaceId}:queue_lag_ms_sum`] = lag;
        fields[`workspace:${input.workspaceId}:queue_lag_samples`] = 1;
    }

    if (input.channelId) {
        fields[`channel:${input.channelId}:queue_lag_ms_sum`] = lag;
        fields[`channel:${input.channelId}:queue_lag_samples`] = 1;
    }

    await bumpMetrics(fields);
}

export async function recordWorkerThroughput(input: QueueMetricInput & { status: WorkerStatus }): Promise<void> {
    const queuePrefix = queueMetricPrefix(input.queueName);
    const metric = input.status === "processed" ? "worker_processed" : "worker_failed";
    const fields: Record<string, number> = {
        [metric]: 1,
        [`${queuePrefix}:${input.status}`]: 1,
    };

    if (input.workspaceId) {
        fields[`workspace:${input.workspaceId}:${metric}`] = 1;
    }

    if (input.channelId) {
        fields[`channel:${input.channelId}:${metric}`] = 1;
    }

    await bumpMetrics(fields);
}

export async function recordAiLatency(input: AiLatencyInput): Promise<void> {
    const latency = normalizeNumber(input.latencyMs);
    const fields: Record<string, number> = {
        ai_latency_ms_sum: latency,
        ai_latency_samples: 1,
    };

    if (input.workspaceId) {
        fields[`workspace:${input.workspaceId}:ai_latency_ms_sum`] = latency;
        fields[`workspace:${input.workspaceId}:ai_latency_samples`] = 1;
    }

    if (input.channelId) {
        fields[`channel:${input.channelId}:ai_latency_ms_sum`] = latency;
        fields[`channel:${input.channelId}:ai_latency_samples`] = 1;
    }

    if (input.model) {
        fields[`model:${input.model}:ai_latency_ms_sum`] = latency;
        fields[`model:${input.model}:ai_latency_samples`] = 1;
    }

    await bumpMetrics(fields);
}

export async function recordDeliveryResult(input: DeliveryInput): Promise<void> {
    const metric = input.success ? "delivery_success" : "delivery_failed";
    const fields: Record<string, number> = {
        [metric]: 1,
    };

    if (input.workspaceId) {
        fields[`workspace:${input.workspaceId}:${metric}`] = 1;
    }

    if (input.channelId) {
        fields[`channel:${input.channelId}:${metric}`] = 1;
    }

    await bumpMetrics(fields);
}

function numberFromRecord(record: Record<string, string>, key: string): number {
    const raw = Number(record[key] || 0);
    return Number.isFinite(raw) ? raw : 0;
}

function collectBuckets(minutes: number): Date[] {
    const output: Date[] = [];
    const now = floorToMinute(new Date());

    for (let offset = 0; offset < minutes; offset += 1) {
        output.push(new Date(now.getTime() - offset * 60_000));
    }

    return output;
}

export async function getMetricsSnapshot(windowMinutes: number = 15): Promise<MetricsSnapshot> {
    const normalizedWindow = Math.max(1, Math.min(60 * 24, Math.round(windowMinutes)));
    const buckets = collectBuckets(normalizedWindow);
    const keys = buckets.map((bucket) => bucketKey(bucket));

    const tx = redis.multi();
    for (const key of keys) {
        tx.hgetall(key);
    }

    const response = await tx.exec();
    const rows = (response || []).map((item) => (item?.[1] || {}) as Record<string, string>);

    const queueMap = new Map<string, { processed: number; failed: number; lagSum: number; lagCount: number }>();

    const totals = {
        queueLagMsSum: 0,
        queueLagSamples: 0,
        workerProcessed: 0,
        workerFailed: 0,
        aiLatencyMsSum: 0,
        aiLatencySamples: 0,
        deliverySuccess: 0,
        deliveryFailed: 0,
    };

    for (const row of rows) {
        totals.queueLagMsSum += numberFromRecord(row, "queue_lag_ms_sum");
        totals.queueLagSamples += numberFromRecord(row, "queue_lag_samples");
        totals.workerProcessed += numberFromRecord(row, "worker_processed");
        totals.workerFailed += numberFromRecord(row, "worker_failed");
        totals.aiLatencyMsSum += numberFromRecord(row, "ai_latency_ms_sum");
        totals.aiLatencySamples += numberFromRecord(row, "ai_latency_samples");
        totals.deliverySuccess += numberFromRecord(row, "delivery_success");
        totals.deliveryFailed += numberFromRecord(row, "delivery_failed");

        for (const [field, rawValue] of Object.entries(row)) {
            if (!field.startsWith("queue:")) {
                continue;
            }

            const value = Number(rawValue || 0);
            if (!Number.isFinite(value)) {
                continue;
            }
            const metric = ["processed", "failed", "lag_sum", "lag_count"]
                .find((item) => field.endsWith(`:${item}`));
            if (!metric) {
                continue;
            }
            const queueName = field.slice(6, field.length - (`:${metric}`.length));
            if (!queueName) {
                continue;
            }
            const queue = queueMap.get(queueName) || {
                processed: 0,
                failed: 0,
                lagSum: 0,
                lagCount: 0,
            };

            if (metric === "processed") {
                queue.processed += value;
            } else if (metric === "failed") {
                queue.failed += value;
            } else if (metric === "lag_sum") {
                queue.lagSum += value;
            } else if (metric === "lag_count") {
                queue.lagCount += value;
            }

            queueMap.set(queueName, queue);
        }
    }

    const deliveryTotal = totals.deliverySuccess + totals.deliveryFailed;

    return {
        windowMinutes: normalizedWindow,
        queueLagAvgMs: totals.queueLagSamples > 0
            ? Number((totals.queueLagMsSum / totals.queueLagSamples).toFixed(2))
            : 0,
        aiLatencyAvgMs: totals.aiLatencySamples > 0
            ? Number((totals.aiLatencyMsSum / totals.aiLatencySamples).toFixed(2))
            : 0,
        workerThroughputPerMinute: Number((totals.workerProcessed / normalizedWindow).toFixed(2)),
        deliverySuccessRate: deliveryTotal > 0
            ? Number(((totals.deliverySuccess / deliveryTotal) * 100).toFixed(2))
            : 0,
        totals: {
            queueLagSamples: totals.queueLagSamples,
            workerProcessed: totals.workerProcessed,
            workerFailed: totals.workerFailed,
            aiLatencySamples: totals.aiLatencySamples,
            deliverySuccess: totals.deliverySuccess,
            deliveryFailed: totals.deliveryFailed,
        },
        queueBreakdown: Array.from(queueMap.entries())
            .map(([queueName, value]) => ({
                queueName,
                processed: value.processed,
                failed: value.failed,
                lagAvgMs: value.lagCount > 0
                    ? Number((value.lagSum / value.lagCount).toFixed(2))
                    : 0,
            }))
            .sort((a, b) => (b.processed + b.failed) - (a.processed + a.failed)),
    };
}
