export interface MemoryDbClient {
    memory: {
        upsert: (args: {
            where: { userId_key: { userId: string; key: string } };
            update: { value: string; source?: string; confidence: number };
            create: { userId: string; key: string; value: string; source?: string; confidence: number };
        }) => Promise<unknown>;
        findMany: (args: {
            where: { userId: string };
            orderBy: { updatedAt: "desc" };
        }) => Promise<unknown[]>;
        delete: (args: { where: { id: string } }) => Promise<unknown>;
    };
}

export function createMemoryRepo(db: MemoryDbClient) {
    return {
        async upsertMemory(data: {
            userId: string;
            key: string;
            value: string;
            source?: string;
            confidence?: number;
        }) {
            return db.memory.upsert({
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
            return db.memory.findMany({
                where: { userId },
                orderBy: { updatedAt: "desc" },
            });
        },

        async deleteMemory(id: string) {
            return db.memory.delete({ where: { id } });
        },
    };
}
