import { ChannelHealthStatus, ChannelProvider as PrismaChannelProvider, Prisma } from "@prisma/client";
import { prisma } from "./client";
import { assertTenantScope } from "@/lib/tenant/context";
import { ChannelProvider, normalizeChannelProvider } from "@/lib/channel/provider";

export type ChannelSendPolicy = {
    allowlist?: string[];
    denylist?: string[];
    allowedCountryPrefixes?: string[];
    requireTemplateForBroadcast?: boolean;
    allowedTemplatePrefixes?: string[];
};

function normalizeList(values: string[] | undefined): string[] {
    if (!values || values.length === 0) {
        return [];
    }

    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function sanitizePolicy(policy: ChannelSendPolicy | null | undefined): ChannelSendPolicy {
    if (!policy) {
        return {};
    }

    return {
        allowlist: normalizeList(policy.allowlist),
        denylist: normalizeList(policy.denylist),
        allowedCountryPrefixes: normalizeList(policy.allowedCountryPrefixes),
        requireTemplateForBroadcast: Boolean(policy.requireTemplateForBroadcast),
        allowedTemplatePrefixes: normalizeList(policy.allowedTemplatePrefixes),
    };
}

function toPrismaChannelProvider(provider: ChannelProvider): PrismaChannelProvider {
    return provider === "instagram"
        ? PrismaChannelProvider.INSTAGRAM
        : PrismaChannelProvider.WHATSAPP;
}

const channelAuditInclude = Prisma.validator<Prisma.ChannelAuditInclude>()({
    channel: true,
});

export type ChannelAuditWithChannel = Prisma.ChannelAuditGetPayload<{
    include: typeof channelAuditInclude;
}>;

export const channelRepo = {
    async listWorkspaceChannels(workspaceId: string, options?: { includeRemoved?: boolean; provider?: ChannelProvider | string }) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const includeRemoved = options?.includeRemoved === true;
        const provider = options?.provider ? normalizeChannelProvider(options.provider) : undefined;
        const providerType = provider ? toPrismaChannelProvider(provider) : undefined;

        return prisma.channel.findMany({
            where: {
                workspaceId: resolvedWorkspaceId,
                providerType,
                ...(includeRemoved ? {} : { status: { not: "removed" } }),
            },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        });
    },

    async listActiveRuntimeChannels(provider: ChannelProvider | string = "whatsapp") {
        const resolvedProvider = normalizeChannelProvider(provider);
        const providerType = toPrismaChannelProvider(resolvedProvider);
        return prisma.channel.findMany({
            where: {
                providerType,
                isEnabled: true,
                status: { not: "removed" },
                workspace: { isActive: true },
            },
            include: {
                workspace: {
                    select: {
                        id: true,
                        isActive: true,
                    },
                },
            },
            orderBy: [{ workspaceId: "asc" }, { isPrimary: "desc" }, { createdAt: "asc" }],
        });
    },

    async getChannelById(channelId: string) {
        return prisma.channel.findUnique({
            where: { id: channelId },
            include: {
                workspace: {
                    select: {
                        id: true,
                        isActive: true,
                    },
                },
            },
        });
    },

    async getWorkspaceChannel(workspaceId: string, channelId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.channel.findFirst({
            where: {
                id: channelId,
                workspaceId: resolvedWorkspaceId,
            },
        });
    },

    async getPrimaryWorkspaceChannel(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const primary = await prisma.channel.findFirst({
            where: {
                workspaceId: resolvedWorkspaceId,
                isEnabled: true,
                status: { not: "removed" },
                isPrimary: true,
            },
            orderBy: { createdAt: "asc" },
        });

        if (primary) {
            return primary;
        }

        return prisma.channel.findFirst({
            where: {
                workspaceId: resolvedWorkspaceId,
                isEnabled: true,
                status: { not: "removed" },
            },
            orderBy: { createdAt: "asc" },
        });
    },

    async ensureWorkspaceHasPrimary(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const currentPrimary = await prisma.channel.findFirst({
            where: {
                workspaceId: resolvedWorkspaceId,
                isEnabled: true,
                status: { not: "removed" },
                isPrimary: true,
            },
            select: { id: true },
        });

        if (currentPrimary) {
            return currentPrimary.id;
        }

        const fallback = await prisma.channel.findFirst({
            where: {
                workspaceId: resolvedWorkspaceId,
                isEnabled: true,
                status: { not: "removed" },
            },
            orderBy: { createdAt: "asc" },
            select: { id: true },
        });

        if (!fallback) {
            return null;
        }

        await prisma.channel.update({
            where: { id: fallback.id },
            data: { isPrimary: true },
        });

        return fallback.id;
    },

    async createChannel(input: {
        workspaceId: string;
        name: string;
        provider?: ChannelProvider | string;
        identifier?: string;
        rateLimitPerSecond?: number;
        policy?: ChannelSendPolicy | null;
        isPrimary?: boolean;
    }) {
        const resolvedWorkspaceId = assertTenantScope(input.workspaceId);
        const sanitizedPolicy = sanitizePolicy(input.policy ?? {});
        const provider = normalizeChannelProvider(input.provider);

        const channel = await prisma.channel.create({
            data: {
                workspaceId: resolvedWorkspaceId,
                name: input.name.trim(),
                provider,
                providerType: toPrismaChannelProvider(provider),
                identifier: input.identifier?.trim() || null,
                status: "active",
                isEnabled: true,
                isPrimary: Boolean(input.isPrimary),
                rateLimitPerSecond: Number.isFinite(input.rateLimitPerSecond)
                    ? Math.max(1, Math.min(100, Math.round(input.rateLimitPerSecond as number)))
                    : 5,
                policy: sanitizedPolicy as Prisma.InputJsonValue,
            },
        });

        if (channel.isPrimary) {
            await prisma.channel.updateMany({
                where: {
                    workspaceId: resolvedWorkspaceId,
                    id: { not: channel.id },
                },
                data: { isPrimary: false },
            });
        } else {
            await this.ensureWorkspaceHasPrimary(resolvedWorkspaceId);
        }

        await this.createAudit(channel.id, {
            eventType: "channel_created",
            status: "success",
            message: "Channel created",
        });

        return channel;
    },

    async updateChannel(channelId: string, input: {
        name?: string;
        identifier?: string | null;
        isEnabled?: boolean;
        isPrimary?: boolean;
        rateLimitPerSecond?: number;
        policy?: ChannelSendPolicy | null;
        status?: string;
    }) {
        const data: Prisma.ChannelUpdateInput = {};

        if (typeof input.name === "string") {
            data.name = input.name.trim();
        }
        if (input.identifier !== undefined) {
            data.identifier = input.identifier ? input.identifier.trim() : null;
        }
        if (typeof input.isEnabled === "boolean") {
            data.isEnabled = input.isEnabled;
        }
        if (typeof input.isPrimary === "boolean") {
            data.isPrimary = input.isPrimary;
        }
        if (typeof input.rateLimitPerSecond === "number" && Number.isFinite(input.rateLimitPerSecond)) {
            data.rateLimitPerSecond = Math.max(1, Math.min(100, Math.round(input.rateLimitPerSecond)));
        }
        if (input.policy !== undefined) {
            data.policy = sanitizePolicy(input.policy ?? {}) as Prisma.InputJsonValue;
        }
        if (typeof input.status === "string") {
            data.status = input.status;
        }

        const updated = await prisma.channel.update({
            where: { id: channelId },
            data,
        });

        if (input.isPrimary === true) {
            await prisma.channel.updateMany({
                where: {
                    workspaceId: updated.workspaceId,
                    id: { not: updated.id },
                },
                data: { isPrimary: false },
            });
        }

        await this.ensureWorkspaceHasPrimary(updated.workspaceId);

        if (input.policy !== undefined) {
            await this.createAudit(updated.id, {
                eventType: `${updated.provider}_channel_policy_updated`,
                status: "success",
                message: "channel_policy_updated",
                metadata: {
                    provider: updated.provider,
                    policy: sanitizePolicy(input.policy ?? {}),
                },
            });
        }

        return updated;
    },

    async softDeleteChannel(channelId: string) {
        const channel = await prisma.channel.update({
            where: { id: channelId },
            data: {
                isEnabled: false,
                isPrimary: false,
                status: "removed",
                healthStatus: ChannelHealthStatus.DISCONNECTED,
            },
        });

        await this.ensureWorkspaceHasPrimary(channel.workspaceId);

        await this.createAudit(channelId, {
            eventType: "channel_removed",
            status: "success",
            message: "Channel removed",
        });

        return channel;
    },

    async updateHealth(channelId: string, input: {
        healthStatus: ChannelHealthStatus;
        healthScore: number;
        status?: string;
        message?: string;
        markSeen?: boolean;
    }) {
        const nextStatus = input.status || (input.healthStatus === ChannelHealthStatus.CONNECTED ? "active" : undefined);

        return prisma.channel.update({
            where: { id: channelId },
            data: {
                healthStatus: input.healthStatus,
                healthScore: Math.max(0, Math.min(100, Math.round(input.healthScore))),
                status: nextStatus,
                lastError: input.message || null,
                lastSeenAt: input.markSeen ? new Date() : undefined,
            },
        });
    },

    async getRecentAudits(channelId: string, limit: number = 50): Promise<ChannelAuditWithChannel[]> {
        return prisma.channelAudit.findMany({
            where: { channelId },
            include: channelAuditInclude,
            orderBy: { createdAt: "desc" },
            take: Math.max(1, Math.min(200, Math.round(limit))),
        });
    },

    async createAudit(channelId: string, input: {
        eventType: string;
        status: string;
        message?: string;
        metadata?: Record<string, unknown>;
    }) {
        return prisma.channelAudit.create({
            data: {
                channelId,
                eventType: input.eventType,
                status: input.status,
                message: input.message,
                metadata: (input.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
            },
        });
    },
};

export function parseChannelPolicy(value: unknown): ChannelSendPolicy {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    const record = value as Record<string, unknown>;

    return sanitizePolicy({
        allowlist: Array.isArray(record.allowlist) ? record.allowlist.filter((item): item is string => typeof item === "string") : [],
        denylist: Array.isArray(record.denylist) ? record.denylist.filter((item): item is string => typeof item === "string") : [],
        allowedCountryPrefixes: Array.isArray(record.allowedCountryPrefixes)
            ? record.allowedCountryPrefixes.filter((item): item is string => typeof item === "string")
            : [],
        requireTemplateForBroadcast: record.requireTemplateForBroadcast === true,
        allowedTemplatePrefixes: Array.isArray(record.allowedTemplatePrefixes)
            ? record.allowedTemplatePrefixes.filter((item): item is string => typeof item === "string")
            : [],
    });
}
