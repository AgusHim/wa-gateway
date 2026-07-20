import { prisma } from "./client";
import { Prisma } from "@prisma/client";
import { assertTenantScope } from "@/lib/tenant/context";
import type { InboundAttachmentPayload } from "@/lib/media/types";
import { emitConversationMessage, emitConversationStatus } from "@/lib/realtime/conversationEvents";

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
        channelId?: string;
        deliveryStatus?: string;
        idempotencyKey?: string;
        externalMessageId?: string;
        attachments?: InboundAttachmentPayload[];
    }) {
        const resolvedWorkspaceId = assertTenantScope(data.workspaceId);
        const metadata = data.metadata || {};
        const channelId = data.channelId?.trim()
            || (typeof metadata.channelId === "string" ? metadata.channelId.trim() : "")
            || undefined;
        const message = await prisma.message.create({
            data: {
                workspaceId: resolvedWorkspaceId,
                userId: data.userId,
                role: data.role,
                content: data.content,
                toolName: data.toolName,
                channelId,
                deliveryStatus: data.deliveryStatus,
                idempotencyKey: data.idempotencyKey,
                externalMessageId: data.externalMessageId,
                metadata: metadata as Prisma.InputJsonValue ?? Prisma.JsonNull,
                attachments: data.attachments?.length
                    ? {
                        create: data.attachments.map((attachment) => ({
                            workspaceId: resolvedWorkspaceId,
                            type: attachment.type,
                            status: attachment.status,
                            storageKey: attachment.storageKey,
                            fileName: attachment.fileName,
                            mimeType: attachment.mimeType,
                            byteSize: attachment.byteSize,
                            checksum: attachment.checksum,
                            durationMs: attachment.durationMs,
                            isAnimated: attachment.isAnimated ?? false,
                            errorMessage: attachment.errorMessage,
                        })),
                    }
                    : undefined,
            },
            include: { attachments: true },
        });

        emitConversationMessage({
            workspaceId: resolvedWorkspaceId,
            channelId: message.channelId,
            userId: message.userId,
            messageId: message.id,
            deliveryStatus: message.deliveryStatus,
        });
        return message;
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
                OR: normalizedChannelId
                    ? [
                        { channelId: normalizedChannelId },
                        {
                            channelId: null,
                            metadata: {
                                path: ["channelId"],
                                equals: normalizedChannelId,
                            },
                        },
                    ]
                    : undefined,
            },
            orderBy: { createdAt: "asc" },
            skip,
            take: pageSize,
            include: { attachments: true },
        });
    },

    async getConversationPage(input: {
        workspaceId: string;
        userId: string;
        channelId: string;
        cursor?: string;
        limit?: number;
    }) {
        const workspaceId = assertTenantScope(input.workspaceId);
        const channelId = input.channelId.trim();
        const limit = Math.max(1, Math.min(100, Math.round(input.limit || 50)));
        const rows = await prisma.message.findMany({
            where: {
                workspaceId,
                userId: input.userId,
                OR: [
                    { channelId },
                    {
                        channelId: null,
                        metadata: {
                            path: ["channelId"],
                            equals: channelId,
                        },
                    },
                ],
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: limit + 1,
            cursor: input.cursor ? { id: input.cursor } : undefined,
            skip: input.cursor ? 1 : 0,
            include: { attachments: true },
        });
        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit);
        const nextCursor = hasMore ? page[page.length - 1]?.id || null : null;
        return {
            messages: page.reverse(),
            nextCursor,
        };
    },

    async getLatestMessagesByUser(workspaceId: string, userIds: string[], channelId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        if (userIds.length === 0) return [];
        return prisma.message.findMany({
            where: {
                workspaceId: resolvedWorkspaceId,
                userId: { in: userIds },
                OR: [
                    { channelId },
                    {
                        channelId: null,
                        metadata: {
                            path: ["channelId"],
                            equals: channelId,
                        },
                    },
                ],
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            distinct: ["userId"],
            select: {
                id: true,
                userId: true,
                content: true,
                createdAt: true,
            },
        });
    },

    async getMessageById(workspaceId: string, messageId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.message.findFirst({
            where: { id: messageId, workspaceId: resolvedWorkspaceId },
            include: { attachments: true },
        });
    },

    async getMessageByIdempotencyKey(workspaceId: string, idempotencyKey: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.message.findFirst({
            where: { workspaceId: resolvedWorkspaceId, idempotencyKey },
            include: { attachments: true },
        });
    },

    async updateDeliveryStatus(input: {
        workspaceId: string;
        messageId: string;
        status: "queued" | "sent" | "failed";
        externalMessageId?: string;
        errorMessage?: string;
    }) {
        const workspaceId = assertTenantScope(input.workspaceId);
        const current = await prisma.message.findFirst({
            where: { id: input.messageId, workspaceId },
            select: { id: true, userId: true, channelId: true, metadata: true },
        });
        if (!current) return null;

        const metadata = asRecord(current.metadata);
        const updated = await prisma.message.update({
            where: { id: current.id },
            data: {
                deliveryStatus: input.status,
                externalMessageId: input.externalMessageId,
                metadata: {
                    ...metadata,
                    outboundStatus: input.status,
                    outboundError: input.errorMessage || null,
                    outboundUpdatedAt: new Date().toISOString(),
                } as Prisma.InputJsonValue,
            },
            include: { attachments: true },
        });

        emitConversationStatus({
            workspaceId,
            channelId: updated.channelId,
            userId: updated.userId,
            messageId: updated.id,
            deliveryStatus: updated.deliveryStatus,
        });
        return updated;
    },

    async getAttachment(workspaceId: string, attachmentId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.messageAttachment.findFirst({
            where: {
                id: attachmentId,
                workspaceId: resolvedWorkspaceId,
                message: { workspaceId: resolvedWorkspaceId },
            },
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
