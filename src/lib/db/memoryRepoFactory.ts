import { redactPiiFromString } from "../security/pii";

export interface MemoryDbClient {
    memory: {
        upsert: (args: Record<string, unknown>) => Promise<unknown>;
        findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
        deleteMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
    };
}

function assertWorkspaceId(workspaceId: string): string {
    const value = workspaceId.trim();
    if (!value) {
        throw new Error("workspaceId is required");
    }
    return value;
}

export function createMemoryRepo(db: MemoryDbClient) {
    return {
        async upsertMemory(data: {
            workspaceId: string;
            userId: string;
            channelId?: string | null;
            key: string;
            value: string;
            source?: string;
            confidence?: number;
        }) {
            const workspaceId = assertWorkspaceId(data.workspaceId);
            const channelId = data.channelId?.trim() || null;
            const key = data.key.trim();
            if (!key) {
                throw new Error("memory key is required");
            }
            const value = redactPiiFromString(data.value);
            return db.memory.upsert({
                where: {
                    workspaceId_userId_channelId_key: {
                        workspaceId,
                        userId: data.userId,
                        channelId,
                        key,
                    },
                },
                update: {
                    value,
                    source: data.source,
                    confidence: data.confidence ?? 1.0,
                },
                create: {
                    workspaceId,
                    userId: data.userId,
                    channelId,
                    key,
                    value,
                    source: data.source,
                    confidence: data.confidence ?? 1.0,
                },
            });
        },

        async getMemoriesByUser(userId: string, workspaceId: string, channelId?: string) {
            const resolvedWorkspaceId = assertWorkspaceId(workspaceId);
            const normalizedChannelId = channelId?.trim() || "";
            const rows = await db.memory.findMany({
                where: { workspaceId: resolvedWorkspaceId, userId },
                orderBy: { updatedAt: "desc" },
            });

            if (!normalizedChannelId) {
                return rows;
            }

            const channelSpecific = rows.filter((item) => {
                const row = item as { channelId?: string | null };
                return row.channelId === normalizedChannelId;
            });
            const globalRows = rows.filter((item) => {
                const row = item as { channelId?: string | null };
                return row.channelId === null || row.channelId === undefined;
            });

            const merged = [...channelSpecific, ...globalRows];
            const seen = new Set<string>();
            const deduped: unknown[] = [];

            for (const item of merged) {
                const row = item as { key?: string };
                const key = row.key || "";
                if (!key || seen.has(key)) {
                    continue;
                }
                seen.add(key);
                deduped.push(item);
            }

            return deduped;
        },

        async deleteMemory(id: string, workspaceId: string) {
            const resolvedWorkspaceId = assertWorkspaceId(workspaceId);
            const result = await db.memory.deleteMany({
                where: {
                    id,
                    workspaceId: resolvedWorkspaceId,
                },
            });

            if (result.count === 0) {
                throw new Error("Memory not found in workspace");
            }
        },
    };
}
