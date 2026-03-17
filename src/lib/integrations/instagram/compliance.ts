import { redis } from "@/lib/queue/client";
import type { InstagramInboundEventType } from "./webhookQueue";

export type InstagramOutboundPolicyCheckInput = {
    eventType: InstagramInboundEventType;
    occurredAt?: number;
    responseText: string;
};

export type InstagramOutboundPolicyCheckResult = {
    ok: boolean;
    reasonCode?: string;
    message?: string;
    violations: string[];
};

export type InstagramOutboundRateLimitCheckInput = {
    workspaceId: string;
    channelId: string;
    channelLimitPerSecond: number;
};

export type InstagramOutboundRateLimitCheckResult = {
    ok: boolean;
    channelCount: number;
    tenantCount: number;
    channelLimit: number;
    tenantLimit: number;
};

function parseIntegerEnv(name: string, fallback: number, min: number, max: number): number {
    const parsed = Number(process.env[name]);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function policyWindowMs(eventType: InstagramInboundEventType): number {
    const dmHours = parseIntegerEnv("INSTAGRAM_DM_POLICY_WINDOW_HOURS", 24, 1, 168);
    const commentHours = parseIntegerEnv("INSTAGRAM_COMMENT_POLICY_WINDOW_HOURS", 168, 1, 24 * 30);
    const hours = eventType === "instagram-dm" ? dmHours : commentHours;
    return hours * 60 * 60 * 1000;
}

function maxReplyChars(eventType: InstagramInboundEventType): number {
    const dmMax = parseIntegerEnv("INSTAGRAM_DM_MAX_REPLY_CHARS", 1000, 10, 4000);
    const commentMax = parseIntegerEnv("INSTAGRAM_COMMENT_MAX_REPLY_CHARS", 300, 10, 2200);
    return eventType === "instagram-dm" ? dmMax : commentMax;
}

export function evaluateInstagramOutboundPolicy(input: InstagramOutboundPolicyCheckInput): InstagramOutboundPolicyCheckResult {
    const text = input.responseText.trim();
    const violations: string[] = [];

    if (!text) {
        violations.push("empty_reply");
    }

    const maxChars = maxReplyChars(input.eventType);
    if (text.length > maxChars) {
        violations.push("reply_too_long");
    }

    if (Number.isFinite(input.occurredAt)) {
        const elapsedMs = Date.now() - Math.max(0, Number(input.occurredAt));
        const windowMs = policyWindowMs(input.eventType);
        if (elapsedMs > windowMs) {
            violations.push("policy_window_expired");
        }
    }

    if (violations.length > 0) {
        const reasonCode = violations[0] || "policy_rejected";
        return {
            ok: false,
            reasonCode,
            message: `Instagram outbound policy rejected: ${violations.join(", ")}`,
            violations,
        };
    }

    return {
        ok: true,
        violations: [],
    };
}

export async function consumeInstagramOutboundRateLimit(
    input: InstagramOutboundRateLimitCheckInput
): Promise<InstagramOutboundRateLimitCheckResult> {
    const nowSecond = Math.floor(Date.now() / 1000);
    const tenantLimit = parseIntegerEnv("INSTAGRAM_TENANT_RATE_LIMIT_PER_SEC", 15, 1, 1000);
    const channelLimit = Math.max(1, Math.round(input.channelLimitPerSecond || 1));

    const tenantKey = `ig:rate:tenant:${input.workspaceId}:${nowSecond}`;
    const channelKey = `ig:rate:channel:${input.channelId}:${nowSecond}`;

    const [tenantCount, channelCount] = await Promise.all([
        redis.incr(tenantKey),
        redis.incr(channelKey),
    ]);

    if (tenantCount === 1) {
        await redis.expire(tenantKey, 2);
    }

    if (channelCount === 1) {
        await redis.expire(channelKey, 2);
    }

    return {
        ok: tenantCount <= tenantLimit && channelCount <= channelLimit,
        channelCount,
        tenantCount,
        channelLimit,
        tenantLimit,
    };
}

