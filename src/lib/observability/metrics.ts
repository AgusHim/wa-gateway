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
    provider?: "whatsapp" | "instagram";
};

type DeliveryInput = {
    workspaceId?: string;
    channelId?: string;
    success: boolean;
    provider?: "whatsapp" | "instagram";
};

type DeliveryFailureReasonInput = {
    workspaceId?: string;
    channelId?: string;
    reason: string;
};

type InstagramWebhookIngestStatus = "accepted" | "duplicate" | "skipped";

type InstagramWebhookIngestInput = {
    workspaceId?: string;
    channelId?: string;
    eventType?: "instagram-dm" | "instagram-comment";
    status: InstagramWebhookIngestStatus;
    count?: number;
};

export type MetricsScope = {
    workspaceId?: string;
    channelId?: string;
};

export type MetricsSnapshot = {
    windowMinutes: number;
    queueLagAvgMs: number;
    aiLatencyAvgMs: number;
    workerThroughputPerMinute: number;
    deliverySuccessRate: number;
    instagram: {
        webhookIngestPerMinute: number;
        webhookAccepted: number;
        webhookDuplicate: number;
        webhookSkipped: number;
        queueLagAvgMs: number;
        workerThroughputPerMinute: number;
        aiLatencyAvgMs: number;
        outboundSuccessRate: number;
    };
    totals: {
        queueLagSamples: number;
        workerProcessed: number;
        workerFailed: number;
        aiLatencySamples: number;
        deliverySuccess: number;
        deliveryFailed: number;
        instagramWebhookAccepted: number;
        instagramWebhookDuplicate: number;
        instagramWebhookSkipped: number;
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

function scopedMetricField(scope: MetricsScope | undefined, metric: string): string {
    if (scope?.channelId) {
        return `channel:${scope.channelId}:${metric}`;
    }

    if (scope?.workspaceId) {
        return `workspace:${scope.workspaceId}:${metric}`;
    }

    return metric;
}

function sanitizeQueuePart(value: string): string {
    return value.trim().replace(/:/g, "_");
}

function queueMatchesScope(queueName: string, scope: MetricsScope | undefined): boolean {
    if (!scope?.workspaceId && !scope?.channelId) {
        return true;
    }

    const workspacePart = scope?.workspaceId ? sanitizeQueuePart(scope.workspaceId) : "";
    const channelPart = scope?.channelId ? sanitizeQueuePart(scope.channelId) : "";

    if (workspacePart && !queueName.includes(`--${workspacePart}--`)) {
        return false;
    }

    if (channelPart && !queueName.endsWith(`--${channelPart}`)) {
        return false;
    }

    return true;
}

function normalizeReason(reason: string): string {
    const normalized = reason
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return normalized || "unknown";
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

    if (input.provider) {
        fields[`provider:${input.provider}:ai_latency_ms_sum`] = latency;
        fields[`provider:${input.provider}:ai_latency_samples`] = 1;
    }

    if (input.workspaceId && input.provider) {
        fields[`workspace:${input.workspaceId}:provider:${input.provider}:ai_latency_ms_sum`] = latency;
        fields[`workspace:${input.workspaceId}:provider:${input.provider}:ai_latency_samples`] = 1;
    }

    if (input.channelId && input.provider) {
        fields[`channel:${input.channelId}:provider:${input.provider}:ai_latency_ms_sum`] = latency;
        fields[`channel:${input.channelId}:provider:${input.provider}:ai_latency_samples`] = 1;
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

    if (input.provider) {
        fields[`provider:${input.provider}:${metric}`] = 1;
    }

    if (input.workspaceId && input.provider) {
        fields[`workspace:${input.workspaceId}:provider:${input.provider}:${metric}`] = 1;
    }

    if (input.channelId && input.provider) {
        fields[`channel:${input.channelId}:provider:${input.provider}:${metric}`] = 1;
    }

    await bumpMetrics(fields);
}

export async function recordDeliveryFailureReason(input: DeliveryFailureReasonInput): Promise<void> {
    const reason = normalizeReason(input.reason);
    const key = `delivery_failed_reason:${reason}`;
    const fields: Record<string, number> = {
        [key]: 1,
    };

    if (input.workspaceId) {
        fields[`workspace:${input.workspaceId}:${key}`] = 1;
    }

    if (input.channelId) {
        fields[`channel:${input.channelId}:${key}`] = 1;
    }

    await bumpMetrics(fields);
}

export async function recordInstagramWebhookIngest(input: InstagramWebhookIngestInput): Promise<void> {
    const count = normalizeNumber(input.count ?? 1);
    if (count <= 0) {
        return;
    }

    const fields: Record<string, number> = {
        instagram_webhook_ingest_total: count,
        [`instagram_webhook_ingest_${input.status}`]: count,
    };

    if (input.eventType) {
        fields[`instagram_webhook_event_type:${input.eventType}`] = count;
    }

    if (input.workspaceId) {
        fields[`workspace:${input.workspaceId}:instagram_webhook_ingest_total`] = count;
        fields[`workspace:${input.workspaceId}:instagram_webhook_ingest_${input.status}`] = count;
    }

    if (input.channelId) {
        fields[`channel:${input.channelId}:instagram_webhook_ingest_total`] = count;
        fields[`channel:${input.channelId}:instagram_webhook_ingest_${input.status}`] = count;
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

export async function getMetricsSnapshot(
    windowMinutes: number = 15,
    scope?: MetricsScope
): Promise<MetricsSnapshot> {
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
        instagramWebhookIngestTotal: 0,
        instagramWebhookAccepted: 0,
        instagramWebhookDuplicate: 0,
        instagramWebhookSkipped: 0,
        instagramAiLatencyMsSum: 0,
        instagramAiLatencySamples: 0,
        instagramDeliverySuccess: 0,
        instagramDeliveryFailed: 0,
    };

    for (const row of rows) {
        totals.queueLagMsSum += numberFromRecord(row, scopedMetricField(scope, "queue_lag_ms_sum"));
        totals.queueLagSamples += numberFromRecord(row, scopedMetricField(scope, "queue_lag_samples"));
        totals.workerProcessed += numberFromRecord(row, scopedMetricField(scope, "worker_processed"));
        totals.workerFailed += numberFromRecord(row, scopedMetricField(scope, "worker_failed"));
        totals.aiLatencyMsSum += numberFromRecord(row, scopedMetricField(scope, "ai_latency_ms_sum"));
        totals.aiLatencySamples += numberFromRecord(row, scopedMetricField(scope, "ai_latency_samples"));
        totals.deliverySuccess += numberFromRecord(row, scopedMetricField(scope, "delivery_success"));
        totals.deliveryFailed += numberFromRecord(row, scopedMetricField(scope, "delivery_failed"));
        totals.instagramWebhookIngestTotal += numberFromRecord(row, scopedMetricField(scope, "instagram_webhook_ingest_total"));
        totals.instagramWebhookAccepted += numberFromRecord(row, scopedMetricField(scope, "instagram_webhook_ingest_accepted"));
        totals.instagramWebhookDuplicate += numberFromRecord(row, scopedMetricField(scope, "instagram_webhook_ingest_duplicate"));
        totals.instagramWebhookSkipped += numberFromRecord(row, scopedMetricField(scope, "instagram_webhook_ingest_skipped"));
        totals.instagramAiLatencyMsSum += numberFromRecord(
            row,
            scopedMetricField(scope, "provider:instagram:ai_latency_ms_sum")
        );
        totals.instagramAiLatencySamples += numberFromRecord(
            row,
            scopedMetricField(scope, "provider:instagram:ai_latency_samples")
        );
        totals.instagramDeliverySuccess += numberFromRecord(
            row,
            scopedMetricField(scope, "provider:instagram:delivery_success")
        );
        totals.instagramDeliveryFailed += numberFromRecord(
            row,
            scopedMetricField(scope, "provider:instagram:delivery_failed")
        );

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
            if (!queueMatchesScope(queueName, scope)) {
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
    const instagramDeliveryTotal = totals.instagramDeliverySuccess + totals.instagramDeliveryFailed;
    let instagramQueueProcessed = 0;
    let instagramQueueLagSum = 0;
    let instagramQueueLagCount = 0;

    for (const [queueName, value] of queueMap.entries()) {
        if (!queueName.startsWith("instagram-webhook-inbound--")) {
            continue;
        }

        instagramQueueProcessed += value.processed;
        instagramQueueLagSum += value.lagSum;
        instagramQueueLagCount += value.lagCount;
    }

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
        instagram: {
            webhookIngestPerMinute: Number((totals.instagramWebhookIngestTotal / normalizedWindow).toFixed(2)),
            webhookAccepted: totals.instagramWebhookAccepted,
            webhookDuplicate: totals.instagramWebhookDuplicate,
            webhookSkipped: totals.instagramWebhookSkipped,
            queueLagAvgMs: instagramQueueLagCount > 0
                ? Number((instagramQueueLagSum / instagramQueueLagCount).toFixed(2))
                : 0,
            workerThroughputPerMinute: Number((instagramQueueProcessed / normalizedWindow).toFixed(2)),
            aiLatencyAvgMs: totals.instagramAiLatencySamples > 0
                ? Number((totals.instagramAiLatencyMsSum / totals.instagramAiLatencySamples).toFixed(2))
                : 0,
            outboundSuccessRate: instagramDeliveryTotal > 0
                ? Number(((totals.instagramDeliverySuccess / instagramDeliveryTotal) * 100).toFixed(2))
                : 0,
        },
        totals: {
            queueLagSamples: totals.queueLagSamples,
            workerProcessed: totals.workerProcessed,
            workerFailed: totals.workerFailed,
            aiLatencySamples: totals.aiLatencySamples,
            deliverySuccess: totals.deliverySuccess,
            deliveryFailed: totals.deliveryFailed,
            instagramWebhookAccepted: totals.instagramWebhookAccepted,
            instagramWebhookDuplicate: totals.instagramWebhookDuplicate,
            instagramWebhookSkipped: totals.instagramWebhookSkipped,
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
