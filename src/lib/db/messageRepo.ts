import { prisma } from "./client";
import { Prisma } from "@prisma/client";

export const messageRepo = {
    async saveMessage(data: {
        userId: string;
        role: string;
        content: string;
        toolName?: string;
        metadata?: Record<string, unknown>;
    }) {
        return prisma.message.create({
            data: {
                ...data,
                metadata: data.metadata as Prisma.InputJsonValue ?? Prisma.JsonNull,
            },
        });
    },

    async getRecentHistory(userId: string, limit: number = 20) {
        return prisma.message.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: limit,
        }).then((msgs) => msgs.reverse()); // Return in chronological order
    },

    async getConversation(userId: string, page: number = 1, pageSize: number = 50) {
        const skip = (page - 1) * pageSize;
        return prisma.message.findMany({
            where: { userId },
            orderBy: { createdAt: "asc" },
            skip,
            take: pageSize,
        });
    },

    async getTodayMessageCount() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return prisma.message.count({
            where: { createdAt: { gte: today } },
        });
    },

    async getTodayAverageResponseTimeMs() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const messages = await prisma.message.findMany({
            where: {
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
