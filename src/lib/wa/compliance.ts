import { redis } from "@/lib/queue/client";
import { channelRepo, parseChannelPolicy } from "@/lib/db/channelRepo";

export type OutboundMode = "chat" | "broadcast" | "notification";

export type OutboundPolicyCheckInput = {
    workspaceId: string;
    channelId: string;
    phoneNumber: string;
    mode: OutboundMode;
    templateId?: string;
};

export type OutboundPolicyCheckResult = {
    ok: boolean;
    message?: string;
    violations: string[];
};

export type OutboundRateLimitCheckInput = {
    workspaceId: string;
    channelId: string;
    channelLimitPerSecond: number;
};

export type OutboundRateLimitCheckResult = {
    ok: boolean;
    channelCount: number;
    tenantCount: number;
    channelLimit: number;
    tenantLimit: number;
};

function normalizePhone(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (trimmed.includes("@")) {
        return trimmed.split("@")[0].replace(/\D/g, "");
    }

    const digits = trimmed.replace(/\D/g, "");
    if (!digits) return "";

    if (digits.startsWith("0")) {
        return `62${digits.slice(1)}`;
    }
    if (digits.startsWith("8")) {
        return `62${digits}`;
    }

    return digits;
}

function hasPrefix(value: string, prefixes: string[]): boolean {
    if (prefixes.length === 0) return true;
    return prefixes.some((prefix) => value.startsWith(prefix.replace(/\D/g, "")));
}

export async function evaluateOutboundPolicy(input: OutboundPolicyCheckInput): Promise<OutboundPolicyCheckResult> {
    const channel = await channelRepo.getWorkspaceChannel(input.workspaceId, input.channelId);
    if (!channel || !channel.isEnabled || channel.status === "removed") {
        return {
            ok: false,
            message: "Channel tidak aktif",
            violations: ["channel_disabled"],
        };
    }

    const policy = parseChannelPolicy(channel.policy);
    const normalizedPhone = normalizePhone(input.phoneNumber);
    if (!normalizedPhone) {
        return {
            ok: false,
            message: "Nomor tujuan tidak valid",
            violations: ["invalid_phone"],
        };
    }

    const violations: string[] = [];

    if (policy.allowlist && policy.allowlist.length > 0) {
        const normalizedAllow = policy.allowlist.map((item) => normalizePhone(item));
        if (!normalizedAllow.includes(normalizedPhone)) {
            violations.push("not_in_allowlist");
        }
    }

    if (policy.denylist && policy.denylist.length > 0) {
        const normalizedDeny = policy.denylist.map((item) => normalizePhone(item));
        if (normalizedDeny.includes(normalizedPhone)) {
            violations.push("in_denylist");
        }
    }

    if (policy.allowedCountryPrefixes && policy.allowedCountryPrefixes.length > 0) {
        if (!hasPrefix(normalizedPhone, policy.allowedCountryPrefixes)) {
            violations.push("country_not_allowed");
        }
    }

    if ((input.mode === "broadcast" || input.mode === "notification") && policy.requireTemplateForBroadcast) {
        if (!input.templateId) {
            violations.push("template_required");
        }
    }

    if (input.templateId && policy.allowedTemplatePrefixes && policy.allowedTemplatePrefixes.length > 0) {
        const allowed = policy.allowedTemplatePrefixes.some((prefix) => input.templateId?.startsWith(prefix));
        if (!allowed) {
            violations.push("template_not_allowed");
        }
    }

    if (violations.length > 0) {
        return {
            ok: false,
            message: `Outbound policy rejected: ${violations.join(", ")}`,
            violations,
        };
    }

    return {
        ok: true,
        violations: [],
    };
}

export async function consumeOutboundRateLimit(input: OutboundRateLimitCheckInput): Promise<OutboundRateLimitCheckResult> {
    const nowSecond = Math.floor(Date.now() / 1000);
    const tenantLimit = Math.max(1, Number(process.env.WA_TENANT_RATE_LIMIT_PER_SEC || 20));
    const channelLimit = Math.max(1, input.channelLimitPerSecond);

    const tenantKey = `wa:rate:tenant:${input.workspaceId}:${nowSecond}`;
    const channelKey = `wa:rate:channel:${input.channelId}:${nowSecond}`;

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

    const ok = tenantCount <= tenantLimit && channelCount <= channelLimit;

    return {
        ok,
        channelCount,
        tenantCount,
        channelLimit,
        tenantLimit,
    };
}
