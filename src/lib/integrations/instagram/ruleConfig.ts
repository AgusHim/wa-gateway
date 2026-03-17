import { prisma } from "@/lib/db/client";
import { channelRepo } from "@/lib/db/channelRepo";
import { workspaceCredentialRepo } from "@/lib/db/workspaceCredentialRepo";
import { assertTenantScope } from "@/lib/tenant/context";
import { isWithinBusinessHours } from "@/lib/automation/businessHours";

const RULE_PROVIDER = "meta-instagram-config";
const RULE_CREDENTIAL_NAME = "instagram:auto-reply-rules";
const RULE_SECRET_PLACEHOLDER = "ig-rule-config-v1";

export type InstagramRuleKeywordMode = "all" | "keywords";

export type InstagramAutoReplyRules = {
    comment: {
        enabled: boolean;
        keywordMode: InstagramRuleKeywordMode;
        keywords: string[];
        sentimentThreshold: number;
    };
    dm: {
        enabled: boolean;
        keywordMode: InstagramRuleKeywordMode;
        keywords: string[];
        businessHoursOnly: boolean;
        fallbackMessage: string;
        escalationPolicy: string;
    };
};

export type InstagramRuleEvaluation = {
    allowed: boolean;
    reason: string;
    matchedKeywords: string[];
    sentimentScore: number;
    fallbackMessage?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    return fallback;
}

function readNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)));
}

export function defaultInstagramAutoReplyRules(): InstagramAutoReplyRules {
    return {
        comment: {
            enabled: true,
            keywordMode: "all",
            keywords: [],
            sentimentThreshold: -1,
        },
        dm: {
            enabled: true,
            keywordMode: "all",
            keywords: [],
            businessHoursOnly: false,
            fallbackMessage: "",
            escalationPolicy: "none",
        },
    };
}

export function normalizeInstagramAutoReplyRules(input: unknown): InstagramAutoReplyRules {
    const defaults = defaultInstagramAutoReplyRules();
    const source = asRecord(input);
    const comment = asRecord(source.comment);
    const dm = asRecord(source.dm);

    const sentimentThresholdRaw = readNumber(comment.sentimentThreshold, defaults.comment.sentimentThreshold);
    const sentimentThreshold = Math.max(-1, Math.min(1, sentimentThresholdRaw));

    return {
        comment: {
            enabled: readBoolean(comment.enabled, defaults.comment.enabled),
            keywordMode: readString(comment.keywordMode) === "keywords" ? "keywords" : "all",
            keywords: normalizeList(comment.keywords),
            sentimentThreshold,
        },
        dm: {
            enabled: readBoolean(dm.enabled, defaults.dm.enabled),
            keywordMode: readString(dm.keywordMode) === "keywords" ? "keywords" : "all",
            keywords: normalizeList(dm.keywords),
            businessHoursOnly: readBoolean(dm.businessHoursOnly, defaults.dm.businessHoursOnly),
            fallbackMessage: readString(dm.fallbackMessage),
            escalationPolicy: readString(dm.escalationPolicy) || "none",
        },
    };
}

export async function getWorkspaceInstagramAutoReplyRules(workspaceIdInput: string): Promise<InstagramAutoReplyRules> {
    const workspaceId = assertTenantScope(workspaceIdInput);
    const row = await prisma.workspaceCredential.findFirst({
        where: {
            workspaceId,
            provider: RULE_PROVIDER,
            name: RULE_CREDENTIAL_NAME,
        },
        select: {
            metadata: true,
        },
    });

    return normalizeInstagramAutoReplyRules(asRecord(row?.metadata).rules);
}

export async function upsertWorkspaceInstagramAutoReplyRules(input: {
    workspaceId: string;
    userId?: string;
    rules: InstagramAutoReplyRules;
}) {
    const workspaceId = assertTenantScope(input.workspaceId);
    const rules = normalizeInstagramAutoReplyRules(input.rules);

    await workspaceCredentialRepo.upsertCredential({
        workspaceId,
        provider: RULE_PROVIDER,
        name: RULE_CREDENTIAL_NAME,
        secret: RULE_SECRET_PLACEHOLDER,
        metadata: {
            rules,
            updatedBy: input.userId || null,
            updatedAt: new Date().toISOString(),
        },
        createdByUserId: input.userId,
    });

    const channels = await channelRepo.listWorkspaceChannels(workspaceId, {
        provider: "instagram",
    });

    await Promise.all(channels.map((channel) => channelRepo.createAudit(channel.id, {
        eventType: "instagram_policy_updated",
        status: "success",
        message: "auto_reply_rules_updated",
        metadata: {
            updatedBy: input.userId || null,
            commentEnabled: rules.comment.enabled,
            commentKeywordMode: rules.comment.keywordMode,
            dmEnabled: rules.dm.enabled,
            dmKeywordMode: rules.dm.keywordMode,
            dmBusinessHoursOnly: rules.dm.businessHoursOnly,
            dmEscalationPolicy: rules.dm.escalationPolicy,
        },
    })));

    return rules;
}

function sentimentScore(text: string): number {
    const normalized = text.toLowerCase();
    if (!normalized) {
        return 0;
    }

    const positive = ["bagus", "mantap", "suka", "keren", "baik", "terima kasih", "thanks", "love", "great"];
    const negative = ["buruk", "jelek", "kecewa", "marah", "bohong", "scam", "parah", "bad", "hate"];

    let score = 0;
    for (const word of positive) {
        if (normalized.includes(word)) {
            score += 1;
        }
    }
    for (const word of negative) {
        if (normalized.includes(word)) {
            score -= 1;
        }
    }

    if (score === 0) {
        return 0;
    }

    const maxAbs = Math.max(1, Math.min(5, Math.abs(score)));
    return Math.max(-1, Math.min(1, score / maxAbs));
}

function matchKeywords(messageText: string, keywords: string[]): string[] {
    const normalized = messageText.toLowerCase();
    return keywords.filter((keyword) => normalized.includes(keyword));
}

export function evaluateInstagramAutoReplyRule(input: {
    eventType: "instagram-dm" | "instagram-comment";
    messageText: string;
    rules: InstagramAutoReplyRules;
    businessHours?: {
        timezone: string;
        businessHoursStart: string;
        businessHoursEnd: string;
        businessDays: number[];
        outOfHoursAutoReplyEnabled: boolean;
        outOfHoursMessage: string;
    };
}): InstagramRuleEvaluation {
    const text = input.messageText.trim();
    const score = sentimentScore(text);

    if (input.eventType === "instagram-comment") {
        if (!input.rules.comment.enabled) {
            return {
                allowed: false,
                reason: "comment_auto_reply_disabled",
                matchedKeywords: [],
                sentimentScore: score,
            };
        }

        const matched = matchKeywords(text, input.rules.comment.keywords);
        if (input.rules.comment.keywordMode === "keywords" && input.rules.comment.keywords.length > 0 && matched.length === 0) {
            return {
                allowed: false,
                reason: "comment_keyword_not_match",
                matchedKeywords: [],
                sentimentScore: score,
            };
        }

        if (score < input.rules.comment.sentimentThreshold) {
            return {
                allowed: false,
                reason: "comment_sentiment_below_threshold",
                matchedKeywords: matched,
                sentimentScore: score,
            };
        }

        return {
            allowed: true,
            reason: "comment_allowed",
            matchedKeywords: matched,
            sentimentScore: score,
        };
    }

    if (!input.rules.dm.enabled) {
        return {
            allowed: false,
            reason: "dm_auto_reply_disabled",
            matchedKeywords: [],
            sentimentScore: score,
        };
    }

    const matched = matchKeywords(text, input.rules.dm.keywords);
    if (input.rules.dm.keywordMode === "keywords" && input.rules.dm.keywords.length > 0 && matched.length === 0) {
        return {
            allowed: false,
            reason: "dm_keyword_not_match",
            matchedKeywords: [],
            sentimentScore: score,
        };
    }

    if (input.rules.dm.businessHoursOnly && input.businessHours) {
        const withinBusinessHours = isWithinBusinessHours(input.businessHours);
        if (!withinBusinessHours) {
            return {
                allowed: false,
                reason: "dm_outside_business_hours",
                matchedKeywords: matched,
                sentimentScore: score,
                fallbackMessage: input.rules.dm.fallbackMessage || undefined,
            };
        }
    }

    return {
        allowed: true,
        reason: "dm_allowed",
        matchedKeywords: matched,
        sentimentScore: score,
    };
}
