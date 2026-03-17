import { Queue } from "bullmq";
import { redis } from "@/lib/queue/client";
import { assertTenantScope } from "@/lib/tenant/context";

export type InstagramInboundEventType = "instagram-dm" | "instagram-comment";

export interface InstagramWebhookQueueJob {
    workspaceId: string;
    channelId: string;
    eventId: string;
    eventKey: string;
    eventType: InstagramInboundEventType;
    occurredAt: number;
    receivedAt: number;
    pageId?: string;
    instagramAccountId?: string;
    igUserId?: string;
    igUsername?: string;
    threadId?: string;
    commentId?: string;
    mediaId?: string;
    messageId?: string;
    messageText?: string;
    rawEvent: Record<string, unknown>;
    sourceObject?: string;
    traceId?: string;
    correlationId?: string;
    replayed?: boolean;
    debounceKey?: string;
    debounceReady?: boolean;
    debouncedCount?: number;
    firstBufferedAt?: number;
    sourceEventIds?: string[];
}

export interface InstagramWebhookDeadLetterJob {
    sourceQueue: string;
    originalJobId?: string;
    failedReason: string;
    attemptsMade: number;
    failedAt: number;
    workspaceId: string;
    channelId: string;
    eventId: string;
    eventKey: string;
    payload: InstagramWebhookQueueJob;
}

const queueCache = new Map<string, Queue<InstagramWebhookQueueJob>>();
const deadLetterQueueCache = new Map<string, Queue<InstagramWebhookDeadLetterJob>>();

function sanitizeQueuePart(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized) {
        throw new Error(`${field} is required`);
    }

    return normalized.replace(/:/g, "_");
}

export function getInstagramWebhookQueueName(workspaceId: string, channelId: string): string {
    const resolvedWorkspaceId = sanitizeQueuePart(assertTenantScope(workspaceId), "workspaceId");
    const resolvedChannelId = sanitizeQueuePart(channelId, "channelId");
    return `instagram-webhook-inbound--${resolvedWorkspaceId}--${resolvedChannelId}`;
}

export function getInstagramWebhookQueue(workspaceId: string, channelId: string): Queue<InstagramWebhookQueueJob> {
    const queueName = getInstagramWebhookQueueName(workspaceId, channelId);
    const cached = queueCache.get(queueName);
    if (cached) {
        return cached;
    }

    const queue = new Queue<InstagramWebhookQueueJob>(queueName, {
        connection: redis,
        defaultJobOptions: {
            attempts: 5,
            backoff: {
                type: "exponential",
                delay: 1000,
            },
            removeOnComplete: 200,
            removeOnFail: 200,
        },
    });

    queueCache.set(queueName, queue);
    return queue;
}

export function getInstagramWebhookDeadLetterQueueName(workspaceId: string, channelId: string): string {
    const resolvedWorkspaceId = sanitizeQueuePart(assertTenantScope(workspaceId), "workspaceId");
    const resolvedChannelId = sanitizeQueuePart(channelId, "channelId");
    return `instagram-webhook-inbound-dlq--${resolvedWorkspaceId}--${resolvedChannelId}`;
}

export function getInstagramWebhookDeadLetterQueue(workspaceId: string, channelId: string): Queue<InstagramWebhookDeadLetterJob> {
    const queueName = getInstagramWebhookDeadLetterQueueName(workspaceId, channelId);
    const cached = deadLetterQueueCache.get(queueName);
    if (cached) {
        return cached;
    }

    const queue = new Queue<InstagramWebhookDeadLetterJob>(queueName, {
        connection: redis,
        defaultJobOptions: {
            removeOnComplete: 500,
            removeOnFail: 500,
        },
    });

    deadLetterQueueCache.set(queueName, queue);
    return queue;
}
