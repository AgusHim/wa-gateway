import { prisma } from "./client";

export const messageRepo = {
    async saveMessage(data: {
        userId: string;
        role: string;
        content: string;
        toolName?: string;
        metadata?: Record<string, unknown>;
    }) {
        return prisma.message.create({ data });
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
};
