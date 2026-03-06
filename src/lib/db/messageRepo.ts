import { prisma } from "./client";
import { Prisma } from "@prisma/client";
import { assertTenantScope } from "@/lib/tenant/context";

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
};
