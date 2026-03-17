import type { Job, JobsOptions, Queue } from "bullmq";
import { redis } from "@/lib/queue/client";
import { logWarn } from "@/lib/observability/logger";
import type { InstagramWebhookQueueJob } from "./webhookQueue";

const DEBOUNCE_KEY_PREFIX = "ig:inbound-debounce";
const DEFAULT_DEBOUNCE_WINDOW_MS = 4_000;
const DEFAULT_BUFFER_TTL_MS = 10 * 60 * 1000;
const LOCK_TTL_MS = 30_000;
const EARLY_TOLERANCE_MS = 120;

type BufferedInstagramInboundEvent = InstagramWebhookQueueJob & {
    bufferedAt: number;
};

export type DebouncedInstagramInboundBatch = {
    data: InstagramWebhookQueueJob;
    batchCount: number;
    firstBufferedAt: number;
};

function parsePositiveIntEnv(name: string, fallback: number, min: number, max: number): number {
    const parsed = Number(process.env[name]);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function getDebounceWindowMs(): number {
    return parsePositiveIntEnv("INSTAGRAM_INBOUND_DEBOUNCE_MS", DEFAULT_DEBOUNCE_WINDOW_MS, 500, 60_000);
}

function getBufferTtlMs(): number {
    const minimum = getDebounceWindowMs() * 2;
    return parsePositiveIntEnv("INSTAGRAM_INBOUND_DEBOUNCE_BUFFER_TTL_MS", DEFAULT_BUFFER_TTL_MS, minimum, 24 * 60 * 60 * 1000);
}

function normalizeKeyPart(value: string | undefined): string {
    const normalized = value?.trim() || "-";
    return normalized.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildDebounceKey(data: Pick<InstagramWebhookQueueJob, "workspaceId" | "channelId" | "threadId" | "igUserId">): string {
    const workspace = normalizeKeyPart(data.workspaceId);
    const channel = normalizeKeyPart(data.channelId);
    const thread = normalizeKeyPart(data.threadId || data.igUserId || "-");
    return `${workspace}:${channel}:${thread}`;
}

function buildRedisKeys(debounceKey: string) {
    return {
        buffer: `${DEBOUNCE_KEY_PREFIX}:buffer:${debounceKey}`,
        dueAt: `${DEBOUNCE_KEY_PREFIX}:due:${debounceKey}`,
        firstBufferedAt: `${DEBOUNCE_KEY_PREFIX}:first:${debounceKey}`,
        lock: `${DEBOUNCE_KEY_PREFIX}:lock:${debounceKey}`,
    };
}

function parseBufferedEvent(raw: string): BufferedInstagramInboundEvent | null {
    try {
        const parsed = JSON.parse(raw) as BufferedInstagramInboundEvent;
        if (!parsed || typeof parsed !== "object") return null;
        if (typeof parsed.workspaceId !== "string") return null;
        if (typeof parsed.channelId !== "string") return null;
        if (typeof parsed.eventId !== "string") return null;
        if (typeof parsed.eventKey !== "string") return null;
        if (parsed.eventType !== "instagram-dm" && parsed.eventType !== "instagram-comment") return null;
        if (typeof parsed.receivedAt !== "number") return null;
        if (typeof parsed.bufferedAt !== "number") return null;
        return parsed;
    } catch {
        return null;
    }
}

function parseUnixMs(raw: string | null | undefined): number | null {
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.round(parsed));
}

async function releaseLock(lockKey: string, token: string) {
    await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        token
    );
}

function joinBatchedMessageText(items: BufferedInstagramInboundEvent[]): string {
    return items
        .map((item) => (item.messageText || "").trim())
        .filter(Boolean)
        .join("\n");
}

function toImmediateBatch(data: InstagramWebhookQueueJob): DebouncedInstagramInboundBatch {
    const firstBufferedAt = data.firstBufferedAt || data.receivedAt || Date.now();
    const debouncedCount = Math.max(1, data.debouncedCount || 1);

    return {
        data: {
            ...data,
            debounceReady: true,
            debouncedCount,
            firstBufferedAt,
        },
        batchCount: debouncedCount,
        firstBufferedAt,
    };
}

export async function enqueueInstagramInboundWithDebounce(
    queue: Queue<InstagramWebhookQueueJob>,
    data: InstagramWebhookQueueJob,
    options?: JobsOptions
): Promise<void> {
    if (data.eventType !== "instagram-dm") {
        await queue.add(`ig-inbound:${data.eventType}:${data.eventId}`, data, options);
        return;
    }

    const now = Date.now();
    const debounceWindowMs = getDebounceWindowMs();
    const bufferTtlMs = getBufferTtlMs();
    const dueAt = now + debounceWindowMs;
    const debounceKey = buildDebounceKey(data);
    const keys = buildRedisKeys(debounceKey);
    const bufferedPayload: BufferedInstagramInboundEvent = {
        ...data,
        bufferedAt: now,
    };

    await redis.multi()
        .rpush(keys.buffer, JSON.stringify(bufferedPayload))
        .pexpire(keys.buffer, bufferTtlMs)
        .set(keys.dueAt, String(dueAt), "PX", bufferTtlMs)
        .set(keys.firstBufferedAt, String(now), "PX", bufferTtlMs, "NX")
        .exec();

    await queue.add(`ig-inbound:dm:${data.channelId}:${data.eventId}`, {
        ...data,
        receivedAt: now,
        debounceKey,
        debounceReady: false,
    }, {
        ...options,
        delay: debounceWindowMs,
    });
}

export async function consumeInstagramInboundDebouncedBatch(
    job: Job<InstagramWebhookQueueJob>
): Promise<DebouncedInstagramInboundBatch | null> {
    if (job.data.eventType !== "instagram-dm" || job.data.debounceReady || !job.data.debounceKey) {
        return toImmediateBatch(job.data);
    }

    const keys = buildRedisKeys(job.data.debounceKey);
    const dueAt = parseUnixMs(await redis.get(keys.dueAt));
    if (dueAt === null && (job.name.startsWith("replay:") || job.attemptsMade > 0)) {
        return toImmediateBatch(job.data);
    }

    const now = Date.now();
    if (dueAt !== null && now + EARLY_TOLERANCE_MS < dueAt) {
        return null;
    }

    const lockToken = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const locked = await redis.set(keys.lock, lockToken, "PX", LOCK_TTL_MS, "NX");
    if (!locked) {
        return null;
    }

    try {
        const refreshedDueAt = parseUnixMs(await redis.get(keys.dueAt));
        if (refreshedDueAt !== null && Date.now() + EARLY_TOLERANCE_MS < refreshedDueAt) {
            return null;
        }

        const bufferedRaw = await redis.lrange(keys.buffer, 0, -1);
        if (bufferedRaw.length === 0) {
            if (refreshedDueAt === null && (job.name.startsWith("replay:") || job.attemptsMade > 0)) {
                return toImmediateBatch(job.data);
            }
            return null;
        }

        const bufferedEvents = bufferedRaw
            .map(parseBufferedEvent)
            .filter((item): item is BufferedInstagramInboundEvent => Boolean(item))
            .sort((left, right) => left.bufferedAt - right.bufferedAt);

        if (bufferedEvents.length === 0) {
            logWarn("instagram.inbound.debounce.invalid_buffer_payload", {
                queueName: job.queueName,
                jobId: String(job.id || ""),
                debounceKey: job.data.debounceKey,
            });
            await redis.del(keys.buffer, keys.dueAt, keys.firstBufferedAt);
            return null;
        }

        const combinedText = joinBatchedMessageText(bufferedEvents);
        const firstBufferedAtFromRedis = parseUnixMs(await redis.get(keys.firstBufferedAt));
        const firstBufferedAtResolved = firstBufferedAtFromRedis
            ?? bufferedEvents[0]?.bufferedAt
            ?? job.data.firstBufferedAt
            ?? job.data.receivedAt
            ?? Date.now();

        await redis.del(keys.buffer, keys.dueAt, keys.firstBufferedAt);

        const latestEvent = bufferedEvents[bufferedEvents.length - 1] || job.data;
        const sourceEventIds = Array.from(new Set(bufferedEvents
            .map((item) => item.eventId.trim())
            .filter(Boolean)));

        return {
            data: {
                ...latestEvent,
                messageText: combinedText || latestEvent.messageText,
                debounceKey: job.data.debounceKey,
                debounceReady: true,
                debouncedCount: bufferedEvents.length,
                firstBufferedAt: firstBufferedAtResolved,
                sourceEventIds: sourceEventIds.length > 0 ? sourceEventIds : undefined,
            },
            batchCount: bufferedEvents.length,
            firstBufferedAt: firstBufferedAtResolved,
        };
    } finally {
        try {
            await releaseLock(keys.lock, lockToken);
        } catch (error) {
            logWarn("instagram.inbound.debounce.release_lock_failed", {
                queueName: job.queueName,
                jobId: String(job.id || ""),
                debounceKey: job.data.debounceKey,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
