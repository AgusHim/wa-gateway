import crypto from "crypto";
import { ChannelProvider } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { redis } from "@/lib/queue/client";
import { assertTenantScope } from "@/lib/tenant/context";
import { recordInstagramWebhookIngest } from "@/lib/observability/metrics";
import { logInfo, logWarn } from "@/lib/observability/logger";
import { startInstagramWebhookWorkerForPartition } from "./webhookWorker";
import {
    type InstagramWebhookQueueJob,
    getInstagramWebhookDeadLetterQueue,
    getInstagramWebhookQueue,
} from "./webhookQueue";
import { enqueueInstagramInboundWithDebounce } from "./inboundDebounce";
import {
    type NormalizedInstagramWebhookEvent,
    normalizeInstagramWebhookPayload,
} from "./webhook";

const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;
const REPLAY_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const REPLAY_KEY_PREFIX = "ig:webhook:event";

export type InstagramWebhookIngestResult = {
    received: number;
    normalized: number;
    accepted: number;
    duplicates: number;
    skipped: number;
};

type InstagramChannelResolution = {
    workspaceId: string;
    channelId: string;
};

type ReplaySnapshot = {
    eventId: string;
    eventKey: string;
    workspaceId: string;
    channelId: string;
    cachedAt: string;
    queueJob: InstagramWebhookQueueJob;
};

function parseBoolEnv(name: string, fallback: boolean): boolean {
    const raw = String(process.env[name] || "").trim().toLowerCase();
    if (!raw) {
        return fallback;
    }
    return raw !== "false" && raw !== "0" && raw !== "off" && raw !== "no";
}

function parsePriorityEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(1, Math.min(1024, Math.round(parsed)));
}

function resolveQueuePriority(eventType: NormalizedInstagramWebhookEvent["eventType"]): number | undefined {
    const prioritizeDm = parseBoolEnv("INSTAGRAM_DM_PRIORITY_ENABLED", true);
    if (!prioritizeDm) {
        return undefined;
    }

    const dmPriority = parsePriorityEnv("INSTAGRAM_DM_QUEUE_PRIORITY", 1);
    const commentPriority = parsePriorityEnv("INSTAGRAM_COMMENT_QUEUE_PRIORITY", 8);
    return eventType === "instagram-dm" ? dmPriority : commentPriority;
}

function readRecord(value: unknown): Record<string, unknown> {
    return (value && typeof value === "object" && !Array.isArray(value))
        ? value as Record<string, unknown>
        : {};
}

function resolveReceivedCount(payload: unknown): number {
    const root = readRecord(payload);
    const entries = Array.isArray(root.entry) ? root.entry.length : 0;
    return Math.max(1, entries);
}

function buildIdempotencyKey(workspaceId: string, channelId: string, eventKey: string): string {
    return `ig:webhook:dedupe:${workspaceId}:${channelId}:${eventKey}`;
}

function replayKey(eventId: string): string {
    return `${REPLAY_KEY_PREFIX}:${eventId}`;
}

function buildQueueJob(input: {
    event: NormalizedInstagramWebhookEvent;
    workspaceId: string;
    channelId: string;
    receivedAt: number;
    replayed?: boolean;
}): InstagramWebhookQueueJob {
    return {
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        eventId: input.event.eventId,
        eventKey: input.event.eventKey,
        eventType: input.event.eventType,
        occurredAt: input.event.occurredAt,
        receivedAt: input.receivedAt,
        pageId: input.event.pageId,
        instagramAccountId: input.event.instagramAccountId,
        igUserId: input.event.igUserId,
        igUsername: input.event.igUsername,
        threadId: input.event.threadId,
        commentId: input.event.commentId,
        mediaId: input.event.mediaId,
        messageId: input.event.messageId,
        messageText: input.event.messageText,
        rawEvent: input.event.rawEvent,
        sourceObject: input.event.sourceObject,
        traceId: `ig-${crypto.randomUUID()}`,
        correlationId: input.event.eventId,
        replayed: input.replayed === true,
    };
}

async function resolveChannelForEvent(event: NormalizedInstagramWebhookEvent): Promise<InstagramChannelResolution | null> {
    if (!event.pageId && !event.instagramAccountId) {
        return null;
    }

    const candidates = await prisma.instagramChannelConfig.findMany({
        where: {
            OR: [
                event.pageId ? { pageId: event.pageId } : undefined,
                event.instagramAccountId ? { instagramAccountId: event.instagramAccountId } : undefined,
            ].filter((item): item is NonNullable<typeof item> => Boolean(item)),
            channel: {
                providerType: ChannelProvider.INSTAGRAM,
                isEnabled: true,
                status: {
                    not: "removed",
                },
            },
            workspace: {
                isActive: true,
            },
        },
        select: {
            workspaceId: true,
            channelId: true,
            pageId: true,
            instagramAccountId: true,
            updatedAt: true,
        },
        orderBy: {
            updatedAt: "desc",
        },
        take: 5,
    });

    if (candidates.length === 0) {
        return null;
    }

    const exact = candidates.find((item) => {
        if (event.pageId && event.instagramAccountId) {
            return item.pageId === event.pageId && item.instagramAccountId === event.instagramAccountId;
        }
        return false;
    });

    const byPage = !exact && event.pageId
        ? candidates.find((item) => item.pageId === event.pageId)
        : null;

    const byInstagramAccount = !exact && !byPage && event.instagramAccountId
        ? candidates.find((item) => item.instagramAccountId === event.instagramAccountId)
        : null;

    const selected = exact || byPage || byInstagramAccount || candidates[0];

    if (candidates.length > 1) {
        logWarn("instagram.webhook.channel_resolution_multiple_candidates", {
            eventId: event.eventId,
            eventType: event.eventType,
            pageId: event.pageId,
            instagramAccountId: event.instagramAccountId,
            igUserId: event.igUserId,
            threadId: event.threadId,
            selectedWorkspaceId: selected.workspaceId,
            selectedChannelId: selected.channelId,
            candidateCount: candidates.length,
        });
    }

    return {
        workspaceId: selected.workspaceId,
        channelId: selected.channelId,
    };
}

async function cacheReplaySnapshot(snapshot: ReplaySnapshot): Promise<void> {
    await redis.set(
        replayKey(snapshot.eventId),
        JSON.stringify(snapshot),
        "EX",
        REPLAY_CACHE_TTL_SECONDS
    );
}

async function enqueueToDeadLetter(job: InstagramWebhookQueueJob, reason: string): Promise<void> {
    const dlq = getInstagramWebhookDeadLetterQueue(job.workspaceId, job.channelId);
    await dlq.add(`ig-dlq:enqueue-failed:${job.eventId}:${Date.now()}`, {
        sourceQueue: "instagram-webhook-ingest",
        failedReason: reason,
        attemptsMade: 0,
        failedAt: Date.now(),
        workspaceId: job.workspaceId,
        channelId: job.channelId,
        eventId: job.eventId,
        eventKey: job.eventKey,
        payload: job,
    });
}

export async function ingestInstagramWebhookPayload(input: {
    payload: unknown;
    receivedAt?: number;
}): Promise<InstagramWebhookIngestResult> {
    const receivedAt = Number.isFinite(input.receivedAt) ? Number(input.receivedAt) : Date.now();
    const normalizedEvents = normalizeInstagramWebhookPayload(input.payload);

    let accepted = 0;
    let duplicates = 0;
    let skipped = 0;

    for (const event of normalizedEvents) {
        const resolution = await resolveChannelForEvent(event);
        if (!resolution) {
            skipped += 1;
            await recordInstagramWebhookIngest({
                status: "skipped",
                eventType: event.eventType,
            });
            logWarn("instagram.webhook.skipped.channel_not_found", {
                eventId: event.eventId,
                eventType: event.eventType,
                pageId: event.pageId,
                instagramAccountId: event.instagramAccountId,
                igUserId: event.igUserId,
                threadId: event.threadId,
            });
            continue;
        }

        const workspaceId = assertTenantScope(resolution.workspaceId);
        const channelId = resolution.channelId;
        const dedupeKey = buildIdempotencyKey(workspaceId, channelId, event.eventKey);
        const dedupe = await redis.set(dedupeKey, "1", "EX", IDEMPOTENCY_TTL_SECONDS, "NX");
        if (dedupe !== "OK") {
            duplicates += 1;
            await recordInstagramWebhookIngest({
                workspaceId,
                channelId,
                status: "duplicate",
                eventType: event.eventType,
            });
            logInfo("instagram.webhook.duplicate", {
                workspaceId,
                channelId,
                eventId: event.eventId,
                eventType: event.eventType,
                eventKey: event.eventKey,
                igUserId: event.igUserId,
                threadId: event.threadId,
            });
            continue;
        }

        const queueJob = buildQueueJob({
            event,
            workspaceId,
            channelId,
            receivedAt,
        });

        try {
            startInstagramWebhookWorkerForPartition(workspaceId, channelId);
            const queue = getInstagramWebhookQueue(workspaceId, channelId);
            await enqueueInstagramInboundWithDebounce(queue, queueJob, {
                jobId: `ig-webhook:${workspaceId}:${channelId}:${event.eventKey}`,
                priority: resolveQueuePriority(event.eventType),
            });

            await cacheReplaySnapshot({
                eventId: event.eventId,
                eventKey: event.eventKey,
                workspaceId,
                channelId,
                cachedAt: new Date(receivedAt).toISOString(),
                queueJob,
            });

            accepted += 1;
            await recordInstagramWebhookIngest({
                workspaceId,
                channelId,
                status: "accepted",
                eventType: event.eventType,
            });
            logInfo("instagram.webhook.accepted", {
                workspaceId,
                channelId,
                eventId: event.eventId,
                eventType: event.eventType,
                eventKey: event.eventKey,
                igUserId: event.igUserId,
                threadId: event.threadId,
            });
        } catch (error) {
            skipped += 1;
            const reason = error instanceof Error ? error.message : String(error);
            await enqueueToDeadLetter(queueJob, reason.slice(0, 2000)).catch(() => null);
            await recordInstagramWebhookIngest({
                workspaceId,
                channelId,
                status: "skipped",
                eventType: event.eventType,
            });
            logWarn("instagram.webhook.enqueue_failed", {
                eventId: event.eventId,
                eventType: event.eventType,
                workspaceId,
                channelId,
                igUserId: event.igUserId,
                threadId: event.threadId,
                reason,
            });
        }
    }

    return {
        received: resolveReceivedCount(input.payload),
        normalized: normalizedEvents.length,
        accepted,
        duplicates,
        skipped,
    };
}

export async function replayInstagramWebhookEvent(input: {
    workspaceId: string;
    eventId: string;
}): Promise<{ queued: boolean; reason?: string }> {
    const workspaceId = assertTenantScope(input.workspaceId);
    const eventId = input.eventId.trim();
    if (!eventId) {
        return { queued: false, reason: "eventId is required" };
    }

    const raw = await redis.get(replayKey(eventId));
    if (!raw) {
        return { queued: false, reason: "event not found or expired" };
    }

    let snapshot: ReplaySnapshot;
    try {
        snapshot = JSON.parse(raw) as ReplaySnapshot;
    } catch {
        return { queued: false, reason: "invalid cached event payload" };
    }

    if (snapshot.workspaceId !== workspaceId) {
        return { queued: false, reason: "event does not belong to workspace" };
    }

    const queueJob: InstagramWebhookQueueJob = {
        ...snapshot.queueJob,
        replayed: true,
        receivedAt: Date.now(),
    };

    startInstagramWebhookWorkerForPartition(queueJob.workspaceId, queueJob.channelId);
    const queue = getInstagramWebhookQueue(queueJob.workspaceId, queueJob.channelId);
    await queue.add(`ig-webhook:replay:${queueJob.eventId}`, queueJob, {
        jobId: `ig-webhook:replay:${queueJob.eventId}:${Date.now()}`,
    });

    return { queued: true };
}
