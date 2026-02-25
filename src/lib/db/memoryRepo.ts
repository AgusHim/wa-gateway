import { prisma } from "./client";

export const memoryRepo = {
    async upsertMemory(data: {
        userId: string;
        key: string;
        value: string;
        source?: string;
        confidence?: number;
    }) {
        return prisma.memory.upsert({
            where: {
                userId_key: { userId: data.userId, key: data.key },
            },
            update: {
                value: data.value,
                source: data.source,
                confidence: data.confidence ?? 1.0,
            },
            create: {
                userId: data.userId,
                key: data.key,
                value: data.value,
                source: data.source,
                confidence: data.confidence ?? 1.0,
            },
        });
    },

    async getMemoriesByUser(userId: string) {
        return prisma.memory.findMany({
            where: { userId },
            orderBy: { updatedAt: "desc" },
        });
    },

    async deleteMemory(id: string) {
        return prisma.memory.delete({ where: { id } });
    },
};
