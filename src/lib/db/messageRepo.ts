import { prisma } from "./client";
import { Prisma } from "@prisma/client";
import { assertTenantScope } from "@/lib/tenant/context";

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

export const messageRepo = {
    async saveMessage(data: {
        workspaceId: string;
        userId: string;
        role: string;
        content: string;
        toolName?: string;
        metadata?: Record<string, unknown>;
    }) {
        const resolvedWorkspaceId = assertTenantScope(data.workspaceId);
        return prisma.message.create({
            data: {
                ...data,
                workspaceId: resolvedWorkspaceId,
                metadata: data.metadata as Prisma.InputJsonValue ?? Prisma.JsonNull,
            },
        });
    },

    async getRecentHistory(workspaceId: string, userId: string, limit: number = 20) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.message.findMany({
            where: {
                userId,
                workspaceId: resolvedWorkspaceId,
            },
            orderBy: { createdAt: "desc" },
            take: limit,
        }).then((msgs) => msgs.reverse()); // Return in chronological order
    },

    async getConversation(
        workspaceId: string,
        userId: string,
        page: number = 1,
        pageSize: number = 50,
        channelId?: string
    ) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const skip = (page - 1) * pageSize;
        const normalizedChannelId = channelId?.trim();
        return prisma.message.findMany({
            where: {
                userId,
                workspaceId: resolvedWorkspaceId,
                metadata: normalizedChannelId
                    ? {
                        path: ["channelId"],
                        equals: normalizedChannelId,
                    }
                    : undefined,
            },
            orderBy: { createdAt: "asc" },
            skip,
            take: pageSize,
        });
    },

    async getConversationByInstagramThread(
        workspaceId: string,
        threadId: string,
        page: number = 1,
        pageSize: number = 50,
        channelId?: string
    ) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const normalizedThreadId = threadId.trim();
        if (!normalizedThreadId) {
            return [];
        }

        const skip = (Math.max(1, page) - 1) * pageSize;
        const metadataClauses: Prisma.MessageWhereInput[] = [
            {
                metadata: {
                    path: ["source"],
                    equals: "instagram",
                },
            },
            {
                metadata: {
                    path: ["threadId"],
                    equals: normalizedThreadId,
                },
            },
        ];

        const normalizedChannelId = channelId?.trim();
        if (normalizedChannelId) {
            metadataClauses.push({
                metadata: {
                    path: ["channelId"],
                    equals: normalizedChannelId,
                },
            });
        }

        return prisma.message.findMany({
            where: {
                workspaceId: resolvedWorkspaceId,
                AND: metadataClauses,
            },
            orderBy: { createdAt: "asc" },
            skip,
            take: pageSize,
        });
    },

    async getConversationByInstagramUserId(
        workspaceId: string,
        igUserId: string,
        page: number = 1,
        pageSize: number = 50,
        channelId?: string
    ) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const normalizedIgUserId = igUserId.trim();
        if (!normalizedIgUserId) {
            return [];
        }

        const skip = (Math.max(1, page) - 1) * pageSize;
        const metadataClauses: Prisma.MessageWhereInput[] = [
            {
                metadata: {
                    path: ["source"],
                    equals: "instagram",
                },
            },
            {
                metadata: {
                    path: ["igUserId"],
                    equals: normalizedIgUserId,
                },
            },
        ];

        const normalizedChannelId = channelId?.trim();
        if (normalizedChannelId) {
            metadataClauses.push({
                metadata: {
                    path: ["channelId"],
                    equals: normalizedChannelId,
                },
            });
        }

        return prisma.message.findMany({
            where: {
                workspaceId: resolvedWorkspaceId,
                AND: metadataClauses,
            },
            orderBy: { createdAt: "asc" },
            skip,
            take: pageSize,
        });
    },

    async hasHumanOperatorReplySince(
        workspaceId: string,
        phoneNumber: string,
        since: Date,
        channelId?: string
    ): Promise<boolean> {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const normalizedPhoneNumber = phoneNumber.trim();
        if (!normalizedPhoneNumber) {
            return false;
        }

        const metadataClauses: Prisma.MessageWhereInput[] = [{
            metadata: {
                path: ["source"],
                equals: "human-operator",
            },
        }];

        const normalizedChannelId = channelId?.trim();
        if (normalizedChannelId) {
            metadataClauses.push({
                metadata: {
                    path: ["channelId"],
                    equals: normalizedChannelId,
                },
            });
        }

        const message = await prisma.message.findFirst({
            where: {
                workspaceId: resolvedWorkspaceId,
                role: "assistant",
                createdAt: {
                    gte: since,
                },
                user: {
                    is: {
                        workspaceId: resolvedWorkspaceId,
                        phoneNumber: normalizedPhoneNumber,
                    },
                },
                AND: metadataClauses,
            },
            select: {
                id: true,
            },
        });

        return Boolean(message?.id);
    },

    async hasHumanOperatorReplyInInstagramThreadSince(
        workspaceId: string,
        threadId: string,
        since: Date,
        channelId?: string
    ): Promise<boolean> {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const normalizedThreadId = threadId.trim();
        if (!normalizedThreadId) {
            return false;
        }

        const metadataClauses: Prisma.MessageWhereInput[] = [
            {
                metadata: {
                    path: ["source"],
                    equals: "human-operator",
                },
            },
            {
                metadata: {
                    path: ["threadId"],
                    equals: normalizedThreadId,
                },
            },
        ];

        const normalizedChannelId = channelId?.trim();
        if (normalizedChannelId) {
            metadataClauses.push({
                metadata: {
                    path: ["channelId"],
                    equals: normalizedChannelId,
                },
            });
        }

        const message = await prisma.message.findFirst({
            where: {
                workspaceId: resolvedWorkspaceId,
                role: "assistant",
                createdAt: {
                    gte: since,
                },
                AND: metadataClauses,
            },
            select: {
                id: true,
            },
        });

        return Boolean(message?.id);
    },

    async getTodayMessageCount(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return prisma.message.count({
            where: {
                workspaceId: resolvedWorkspaceId,
                createdAt: { gte: today },
            },
        });
    },

    async getTodayAverageResponseTimeMs(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const messages = await prisma.message.findMany({
            where: {
                workspaceId: resolvedWorkspaceId,
                createdAt: { gte: today },
                role: { in: ["user", "assistant"] },
            },
            orderBy: [{ userId: "asc" }, { createdAt: "asc" }],
            select: {
                userId: true,
                role: true,
                createdAt: true,
            },
        });

        const lastUserMessageByUser: Record<string, Date | undefined> = {};
        const responseTimes: number[] = [];

        for (const message of messages) {
            if (message.role === "user") {
                lastUserMessageByUser[message.userId] = message.createdAt;
                continue;
            }

            const lastUserMessage = lastUserMessageByUser[message.userId];
            if (!lastUserMessage) continue;

            const diffMs = message.createdAt.getTime() - lastUserMessage.getTime();
            if (diffMs >= 0) {
                responseTimes.push(diffMs);
            }
            lastUserMessageByUser[message.userId] = undefined;
        }

        if (responseTimes.length === 0) return null;

        const total = responseTimes.reduce((sum, ms) => sum + ms, 0);
        return Math.round(total / responseTimes.length);
    },

    async attachInstagramOutboundResultByEventId(input: {
        workspaceId: string;
        channelId: string;
        eventId: string;
        outbound: {
            status: "sent" | "failed";
            target: "dm" | "comment";
            externalId?: string;
            reasonCode?: string;
            failureMessage?: string;
            retryable?: boolean;
            statusCode?: number;
            metaCode?: number;
            traceId?: string;
            attempt?: number;
            finalFailure?: boolean;
        };
    }): Promise<boolean> {
        const workspaceId = assertTenantScope(input.workspaceId);
        const channelId = input.channelId.trim();
        const eventId = input.eventId.trim();
        if (!channelId || !eventId) {
            return false;
        }

        const message = await prisma.message.findFirst({
            where: {
                workspaceId,
                role: "assistant",
                AND: [
                    {
                        metadata: {
                            path: ["channelId"],
                            equals: channelId,
                        },
                    },
                    {
                        metadata: {
                            path: ["eventId"],
                            equals: eventId,
                        },
                    },
                ],
            },
            orderBy: {
                createdAt: "desc",
            },
            select: {
                id: true,
                metadata: true,
            },
        });

        if (!message) {
            return false;
        }

        const metadata = asRecord(message.metadata);
        const existingOutbound = asRecord(metadata.outboundInstagram);
        const nextMetadata: Record<string, unknown> = {
            ...metadata,
            outboundInstagram: {
                ...existingOutbound,
                ...input.outbound,
                updatedAt: new Date().toISOString(),
            },
        };

        await prisma.message.update({
            where: {
                id: message.id,
            },
            data: {
                metadata: nextMetadata as Prisma.InputJsonValue,
            },
        });

        return true;
    },

    async getInstagramThreadAutoReplyState(
        workspaceId: string,
        threadId: string,
        channelId?: string
    ): Promise<{ enabled: boolean; updatedAt: Date | null } | null> {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const normalizedThreadId = threadId.trim();
        if (!normalizedThreadId) {
            return null;
        }

        const clauses: Prisma.MessageWhereInput[] = [
            {
                metadata: {
                    path: ["source"],
                    equals: "instagram-thread-control",
                },
            },
            {
                metadata: {
                    path: ["threadId"],
                    equals: normalizedThreadId,
                },
            },
        ];

        const normalizedChannelId = channelId?.trim();
        if (normalizedChannelId) {
            clauses.push({
                metadata: {
                    path: ["channelId"],
                    equals: normalizedChannelId,
                },
            });
        }

        const row = await prisma.message.findFirst({
            where: {
                workspaceId: resolvedWorkspaceId,
                role: "system",
                AND: clauses,
            },
            orderBy: {
                createdAt: "desc",
            },
            select: {
                createdAt: true,
                metadata: true,
            },
        });

        if (!row) {
            return null;
        }

        const metadata = asRecord(row.metadata);
        const enabled = metadata.autoReplyEnabled !== false;
        return {
            enabled,
            updatedAt: row.createdAt || null,
        };
    },

    async setInstagramThreadAutoReplyState(input: {
        workspaceId: string;
        userId: string;
        threadId: string;
        channelId?: string;
        enabled: boolean;
        changedBy?: string;
    }) {
        const resolvedWorkspaceId = assertTenantScope(input.workspaceId);
        const threadId = input.threadId.trim();
        if (!threadId) {
            throw new Error("threadId is required");
        }

        return prisma.message.create({
            data: {
                workspaceId: resolvedWorkspaceId,
                userId: input.userId,
                role: "system",
                content: `[Instagram Thread] auto-reply ${input.enabled ? "enabled" : "disabled"} (${threadId})`,
                metadata: {
                    source: "instagram-thread-control",
                    provider: "instagram",
                    threadId,
                    channelId: input.channelId?.trim() || null,
                    autoReplyEnabled: input.enabled,
                    changedBy: input.changedBy || null,
                } as Prisma.InputJsonValue,
            },
        });
    },
};
