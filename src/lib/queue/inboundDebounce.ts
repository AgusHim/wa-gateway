import type { Job, Queue } from "bullmq";
import { logWarn } from "@/lib/observability/logger";
import { redis } from "./client";
import type { InboundMessageJob } from "./messageQueue";

const DEBOUNCE_KEY_PREFIX = "wa:inbound-debounce";
const DEFAULT_DEBOUNCE_WINDOW_MS = 5_000;
const DEFAULT_BUFFER_TTL_MS = 10 * 60 * 1000;
const LOCK_TTL_MS = 30_000;
const EARLY_TOLERANCE_MS = 120;

type BufferedInboundMessage = InboundMessageJob & {
    receivedAt: number;
};

export type DebouncedInboundBatch = {
    data: InboundMessageJob;
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
    return parsePositiveIntEnv("INBOUND_DEBOUNCE_MS", DEFAULT_DEBOUNCE_WINDOW_MS, 500, 60_000);
}

function getBufferTtlMs(): number {
    const minimum = getDebounceWindowMs() * 2;
    return parsePositiveIntEnv("INBOUND_DEBOUNCE_BUFFER_TTL_MS", DEFAULT_BUFFER_TTL_MS, minimum, 24 * 60 * 60 * 1000);
}

function normalizeKeyPart(value: string | undefined): string {
    const normalized = value?.trim() || "-";
    return normalized.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildDebounceKey(data: Pick<InboundMessageJob, "workspaceId" | "channelId" | "phoneNumber">): string {
    const workspace = normalizeKeyPart(data.workspaceId);
    const channel = normalizeKeyPart(data.channelId || "-");
    const phone = normalizeKeyPart(data.phoneNumber);
    return `${workspace}:${channel}:${phone}`;
}

function buildRedisKeys(debounceKey: string) {
    return {
        buffer: `${DEBOUNCE_KEY_PREFIX}:buffer:${debounceKey}`,
        dueAt: `${DEBOUNCE_KEY_PREFIX}:due:${debounceKey}`,
        firstBufferedAt: `${DEBOUNCE_KEY_PREFIX}:first:${debounceKey}`,
        lock: `${DEBOUNCE_KEY_PREFIX}:lock:${debounceKey}`,
    };
}

function parseBufferedInboundMessage(raw: string): BufferedInboundMessage | null {
    try {
        const parsed = JSON.parse(raw) as BufferedInboundMessage;
        if (!parsed || typeof parsed !== "object") return null;
        if (typeof parsed.messageText !== "string") return null;
        if (typeof parsed.workspaceId !== "string") return null;
        if (typeof parsed.phoneNumber !== "string") return null;
        if (typeof parsed.messageId !== "string") return null;
        if (typeof parsed.enqueuedAt !== "number") return null;
        if (typeof parsed.receivedAt !== "number") return null;
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

function joinBatchedMessageText(items: BufferedInboundMessage[]): string {
    return items
        .map((item) => item.messageText.trim())
        .filter(Boolean)
        .join("\n");
}

function toImmediateBatch(data: InboundMessageJob): DebouncedInboundBatch {
    const firstBufferedAt = data.firstBufferedAt || data.enqueuedAt || Date.now();
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

export async function enqueueInboundWithDebounce(
    queue: Queue<InboundMessageJob>,
    data: InboundMessageJob
): Promise<void> {
    const now = Date.now();
    const debounceWindowMs = getDebounceWindowMs();
    const bufferTtlMs = getBufferTtlMs();
    const dueAt = now + debounceWindowMs;
    const debounceKey = buildDebounceKey(data);
    const keys = buildRedisKeys(debounceKey);
    const bufferedPayload: BufferedInboundMessage = {
        ...data,
        receivedAt: now,
    };

    await redis.multi()
        .rpush(keys.buffer, JSON.stringify(bufferedPayload))
        .pexpire(keys.buffer, bufferTtlMs)
        .set(keys.dueAt, String(dueAt), "PX", bufferTtlMs)
        .set(keys.firstBufferedAt, String(now), "PX", bufferTtlMs, "NX")
        .exec();

    await queue.add(`inbound:${data.channelId || "default"}`, {
        ...data,
        enqueuedAt: now,
        debounceKey,
        debounceReady: false,
    }, {
        delay: debounceWindowMs,
    });
}

export async function consumeInboundDebouncedBatch(
    job: Job<InboundMessageJob>
): Promise<DebouncedInboundBatch | null> {
    if (job.data.debounceReady || !job.data.debounceKey) {
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

        const bufferedMessages = bufferedRaw
            .map(parseBufferedInboundMessage)
            .filter((item): item is BufferedInboundMessage => Boolean(item))
            .sort((left, right) => left.receivedAt - right.receivedAt);

        if (bufferedMessages.length === 0) {
            logWarn("queue.inbound.debounce.invalid_buffer_payload", {
                queueName: job.queueName,
                jobId: String(job.id || ""),
                debounceKey: job.data.debounceKey,
            });
            await redis.del(keys.buffer, keys.dueAt, keys.firstBufferedAt);
            return null;
        }

        const combinedText = joinBatchedMessageText(bufferedMessages);
        const firstBufferedAtFromRedis = parseUnixMs(await redis.get(keys.firstBufferedAt));
        const firstBufferedAtResolved = firstBufferedAtFromRedis
            ?? bufferedMessages[0]?.receivedAt
            ?? job.data.firstBufferedAt
            ?? job.data.enqueuedAt
            ?? Date.now();

        await redis.del(keys.buffer, keys.dueAt, keys.firstBufferedAt);

        if (!combinedText) {
            return null;
        }

        const latestMessage = bufferedMessages[bufferedMessages.length - 1] || job.data;
        const sourceMessageIds = Array.from(new Set(bufferedMessages
            .map((item) => item.messageId.trim())
            .filter(Boolean)));

        return {
            data: {
                workspaceId: latestMessage.workspaceId || job.data.workspaceId,
                channelId: latestMessage.channelId || job.data.channelId,
                phoneNumber: latestMessage.phoneNumber || job.data.phoneNumber,
                messageText: combinedText,
                messageId: latestMessage.messageId || job.data.messageId,
                timestamp: latestMessage.timestamp || job.data.timestamp,
                pushName: latestMessage.pushName || job.data.pushName,
                enqueuedAt: bufferedMessages[0]?.enqueuedAt || job.data.enqueuedAt || Date.now(),
                correlationId: latestMessage.correlationId || job.data.correlationId,
                traceId: latestMessage.traceId || job.data.traceId,
                debounceKey: job.data.debounceKey,
                debounceReady: true,
                debouncedCount: bufferedMessages.length,
                firstBufferedAt: firstBufferedAtResolved,
                sourceMessageIds: sourceMessageIds.length > 0 ? sourceMessageIds : undefined,
            },
            batchCount: bufferedMessages.length,
            firstBufferedAt: firstBufferedAtResolved,
        };
    } finally {
        try {
            await releaseLock(keys.lock, lockToken);
        } catch (error) {
            logWarn("queue.inbound.debounce.release_lock_failed", {
                queueName: job.queueName,
                jobId: String(job.id || ""),
                debounceKey: job.data.debounceKey,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
