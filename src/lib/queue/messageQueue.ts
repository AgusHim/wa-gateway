import { Queue } from "bullmq";
import { redis } from "./client";
import { assertTenantScope, getDefaultTenantContext } from "@/lib/tenant/context";

export interface InboundMessageJob {
    workspaceId: string;
    phoneNumber: string;
    messageText: string;
    messageId: string;
    timestamp: number;
    pushName?: string;
    channelId?: string;
    enqueuedAt: number;
    correlationId?: string;
    traceId?: string;
}

export interface OutboundSendJob {
    workspaceId: string;
    channelId: string;
    phoneNumber: string;
    text: string;
    mode?: "chat" | "broadcast" | "notification";
    templateId?: string;
    campaignId?: string;
    campaignRecipientId?: string;
    requestedAt: number;
    correlationId?: string;
    traceId?: string;
    sourceMessageId?: string;
}

export interface DeadLetterJob<TPayload = Record<string, unknown>> {
    sourceQueue: string;
    originalJobId?: string;
    failedReason: string;
    attemptsMade: number;
    failedAt: number;
    workspaceId?: string;
    channelId?: string;
    correlationId?: string;
    traceId?: string;
    payload: TPayload;
}

const inboundQueueCache = new Map<string, Queue<InboundMessageJob>>();
const outboundQueueCache = new Map<string, Queue<OutboundSendJob>>();
const outboundDeadLetterQueueCache = new Map<string, Queue<DeadLetterJob<OutboundSendJob>>>();

function sanitizeQueuePart(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized) {
        throw new Error(`${field} is required`);
    }

    // BullMQ queue name cannot contain ":".
    return normalized.replace(/:/g, "_");
}

export const messageQueue = new Queue<InboundMessageJob>("whatsapp-inbound", {
    connection: redis,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
    },
});

export const inboundDeadLetterQueue = new Queue<DeadLetterJob<InboundMessageJob>>("whatsapp-inbound-dlq", {
    connection: redis,
    defaultJobOptions: {
        removeOnComplete: 500,
        removeOnFail: 500,
    },
});

export const outboundSendQueue = new Queue<OutboundSendJob>("whatsapp-outbound", {
    connection: redis,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
    },
});

export function getInboundQueueName(workspaceId: string, channelId: string) {
    const resolvedWorkspaceId = sanitizeQueuePart(assertTenantScope(workspaceId), "workspaceId");
    const resolvedChannelId = sanitizeQueuePart(channelId, "channelId");
    return `whatsapp-inbound--${resolvedWorkspaceId}--${resolvedChannelId}`;
}

export function getInboundMessageQueue(workspaceId: string, channelId: string): Queue<InboundMessageJob> {
    const queueName = getInboundQueueName(workspaceId, channelId);
    const cached = inboundQueueCache.get(queueName);
    if (cached) {
        return cached;
    }

    const queue = new Queue<InboundMessageJob>(queueName, {
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
    inboundQueueCache.set(queueName, queue);
    return queue;
}

export function getDefaultInboundMessageQueue() {
    const { workspaceId, channelId } = getDefaultTenantContext();
    return getInboundMessageQueue(workspaceId, channelId);
}

export function getInboundDeadLetterQueue() {
    return inboundDeadLetterQueue;
}

export function getOutboundQueueName(workspaceId: string, channelId: string) {
    const resolvedWorkspaceId = sanitizeQueuePart(assertTenantScope(workspaceId), "workspaceId");
    const resolvedChannelId = sanitizeQueuePart(channelId, "channelId");
    return `whatsapp-outbound--${resolvedWorkspaceId}--${resolvedChannelId}`;
}

export function getOutboundSendQueue(workspaceId: string, channelId: string): Queue<OutboundSendJob> {
    const queueName = getOutboundQueueName(workspaceId, channelId);
    const cached = outboundQueueCache.get(queueName);
    if (cached) {
        return cached;
    }

    const queue = new Queue<OutboundSendJob>(queueName, {
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
    outboundQueueCache.set(queueName, queue);
    return queue;
}

export function getDefaultOutboundSendQueue() {
    const { workspaceId, channelId } = getDefaultTenantContext();
    return getOutboundSendQueue(workspaceId, channelId);
}

export function getOutboundDeadLetterQueueName(workspaceId: string, channelId: string) {
    const resolvedWorkspaceId = sanitizeQueuePart(assertTenantScope(workspaceId), "workspaceId");
    const resolvedChannelId = sanitizeQueuePart(channelId, "channelId");
    return `whatsapp-outbound-dlq--${resolvedWorkspaceId}--${resolvedChannelId}`;
}

export function getOutboundDeadLetterQueue(workspaceId: string, channelId: string): Queue<DeadLetterJob<OutboundSendJob>> {
    const queueName = getOutboundDeadLetterQueueName(workspaceId, channelId);
    const cached = outboundDeadLetterQueueCache.get(queueName);
    if (cached) {
        return cached;
    }

    const queue = new Queue<DeadLetterJob<OutboundSendJob>>(queueName, {
        connection: redis,
        defaultJobOptions: {
            removeOnComplete: 500,
            removeOnFail: 500,
        },
    });

    outboundDeadLetterQueueCache.set(queueName, queue);
    return queue;
}
