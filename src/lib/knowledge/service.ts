import { KnowledgeSourceStatus, KnowledgeSourceType } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { assertTenantScope } from "@/lib/tenant/context";

const MAX_CHUNK_CHARS = 900;

function splitIntoChunks(content: string): string[] {
    const normalized = content
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (!normalized) {
        return [];
    }

    const paragraphs = normalized.split(/\n\n+/);
    const chunks: string[] = [];

    let current = "";
    for (const paragraph of paragraphs) {
        if (!paragraph.trim()) {
            continue;
        }

        const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
        if (candidate.length <= MAX_CHUNK_CHARS) {
            current = candidate;
            continue;
        }

        if (current) {
            chunks.push(current);
            current = "";
        }

        if (paragraph.length <= MAX_CHUNK_CHARS) {
            current = paragraph;
            continue;
        }

        for (let i = 0; i < paragraph.length; i += MAX_CHUNK_CHARS) {
            chunks.push(paragraph.slice(i, i + MAX_CHUNK_CHARS));
        }
    }

    if (current) {
        chunks.push(current);
    }

    return chunks;
}

function estimateTokens(content: string): number {
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words * 1.3));
}

function keywordScore(content: string, keywords: string[]): number {
    const lower = content.toLowerCase();
    let score = 0;
    for (const keyword of keywords) {
        if (lower.includes(keyword)) {
            score += 1;
        }
    }
    return score;
}

export const knowledgeService = {
    async listSources(workspaceId: string, limit: number = 100) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);

        return prisma.knowledgeSource.findMany({
            where: { workspaceId: resolvedWorkspaceId },
            orderBy: [{ version: "desc" }],
            take: Math.max(1, Math.min(1000, Math.round(limit))),
            include: {
                _count: {
                    select: {
                        chunks: true,
                    },
                },
            },
        });
    },

    async createSource(input: {
        workspaceId: string;
        title: string;
        type: KnowledgeSourceType;
        content: string;
        sourceUrl?: string;
        fileName?: string;
        createdByUserId?: string;
    }) {
        const workspaceId = assertTenantScope(input.workspaceId);
        const title = input.title.trim();
        const content = input.content.trim();

        if (!title) {
            throw new Error("title is required");
        }
        if (!content) {
            throw new Error("content is required");
        }

        const latest = await prisma.knowledgeSource.findFirst({
            where: { workspaceId },
            orderBy: [{ version: "desc" }],
            select: { version: true },
        });
        const nextVersion = (latest?.version ?? 0) + 1;

        const chunks = splitIntoChunks(content);
        const created = await prisma.knowledgeSource.create({
            data: {
                workspaceId,
                version: nextVersion,
                title,
                type: input.type,
                sourceUrl: input.sourceUrl?.trim() || null,
                fileName: input.fileName?.trim() || null,
                content,
                status: KnowledgeSourceStatus.ACTIVE,
                createdByUserId: input.createdByUserId,
                chunks: {
                    create: chunks.map((chunk, index) => ({
                        workspaceId,
                        chunkIndex: index,
                        content: chunk,
                        tokenEstimate: estimateTokens(chunk),
                    })),
                },
            },
            include: {
                _count: { select: { chunks: true } },
            },
        });

        return created;
    },

    async archiveSource(workspaceId: string, sourceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);

        const source = await prisma.knowledgeSource.findFirst({
            where: {
                id: sourceId,
                workspaceId: resolvedWorkspaceId,
            },
            select: { id: true },
        });

        if (!source) {
            throw new Error("Knowledge source not found");
        }

        return prisma.knowledgeSource.update({
            where: { id: source.id },
            data: {
                status: KnowledgeSourceStatus.ARCHIVED,
            },
        });
    },

    async search(workspaceId: string, query: string, limit: number = 5) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) {
            return [];
        }

        const keywords = normalizedQuery.split(/\s+/).filter(Boolean).slice(0, 8);
        const anchorKeyword = keywords[0];

        const rows = await prisma.knowledgeChunk.findMany({
            where: {
                workspaceId: resolvedWorkspaceId,
                source: {
                    status: KnowledgeSourceStatus.ACTIVE,
                },
                content: {
                    contains: anchorKeyword,
                    mode: "insensitive",
                },
            },
            include: {
                source: {
                    select: {
                        id: true,
                        title: true,
                        version: true,
                        type: true,
                    },
                },
            },
            orderBy: [{ createdAt: "desc" }],
            take: 200,
        });

        const scored = rows
            .map((row) => ({
                row,
                score: keywordScore(row.content, keywords),
            }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, Math.max(1, Math.min(20, Math.round(limit))));

        return scored.map(({ row, score }) => ({
            score,
            sourceId: row.source.id,
            sourceTitle: row.source.title,
            sourceVersion: row.source.version,
            sourceType: row.source.type,
            chunkId: row.id,
            chunkIndex: row.chunkIndex,
            content: row.content,
        }));
    },
};
