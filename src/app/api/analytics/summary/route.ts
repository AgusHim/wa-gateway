import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireApiSession } from "@/lib/auth/apiSession";
import { toolLogRepo } from "@/lib/db/toolLogRepo";
import type { AnalyticsSummary, AnalyticsTokenUsage } from "@/types/dashboard";

export const runtime = "nodejs";

type MessageRow = {
    role: string;
    userId: string;
    createdAt: Date;
    metadata: unknown;
};

function toDayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function readNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    return value as Record<string, unknown>;
}

function readEventType(metadata: Record<string, unknown>): "instagram-dm" | "instagram-comment" | "" {
    const eventType = readString(metadata.eventType).toLowerCase();
    if (eventType === "instagram-dm" || eventType === "instagram-comment") {
        return eventType;
    }

    const source = readString(metadata.source).toLowerCase();
    if (source === "instagram-dm" || source === "instagram-comment") {
        return source;
    }

    return "";
}

function isInstagramMessage(metadata: Record<string, unknown>): boolean {
    if (readString(metadata.provider).toLowerCase() === "instagram") {
        return true;
    }

    const source = readString(metadata.source).toLowerCase();
    if (source.startsWith("instagram")) {
        return true;
    }

    return readEventType(metadata) !== "";
}

function resolveInstagramThreadKey(row: MessageRow, metadata: Record<string, unknown>): string {
    return readString(metadata.threadId)
        || readString(metadata.igUserId)
        || readString(metadata.commentId)
        || readString(metadata.mediaId)
        || row.userId;
}

export async function GET() {
    const auth = await requireApiSession("read");
    if (!auth.ok) {
        return auth.response;
    }

    const { workspaceId } = auth.context;
    const days = 7;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    const [messages, toolUsage] = await Promise.all([
        prisma.message.findMany({
            where: {
                workspaceId,
                createdAt: { gte: start },
            },
            select: {
                role: true,
                userId: true,
                createdAt: true,
                metadata: true,
            },
            orderBy: { createdAt: "asc" },
        }),
        toolLogRepo.getToolUsageSummary(workspaceId),
    ]);

    const volumeMap = new Map<string, number>();
    for (let i = 0; i < days; i += 1) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        volumeMap.set(toDayKey(date), 0);
    }

    for (const message of messages) {
        const key = toDayKey(message.createdAt);
        volumeMap.set(key, (volumeMap.get(key) ?? 0) + 1);
    }

    const tokenByModel = new Map<string, number>();
    let instagramSuccessCount = 0;
    let instagramFailedCount = 0;
    const instagramFailReasonMap = new Map<string, number>();

    let dmCount = 0;
    let commentCount = 0;
    let autoReplyCount = 0;
    let humanHandledCount = 0;
    const pendingInboundByThread = new Map<string, number>();
    const responseTimes: number[] = [];
    const mediaInsightMap = new Map<string, { inboundCommentCount: number; botReplyCount: number }>();

    for (const message of messages) {
        const metadata = asRecord(message.metadata);
        if (!metadata) {
            continue;
        }

        const isInstagram = isInstagramMessage(metadata);
        const eventType = readEventType(metadata);

        if (message.role === "assistant") {
            const model = String(metadata.model ?? metadata.modelName ?? "unknown");
            const tokenCount =
                readNumber(metadata.totalTokens)
                || readNumber(metadata.tokensTotal)
                || (readNumber(metadata.inputTokens) + readNumber(metadata.outputTokens));

            if (tokenCount > 0) {
                tokenByModel.set(model, (tokenByModel.get(model) ?? 0) + tokenCount);
            }

            const outbound = asRecord(metadata.outboundInstagram);
            if (outbound) {
                const status = String(outbound.status || "").toLowerCase();
                if (status === "sent") {
                    instagramSuccessCount += 1;
                } else if (status === "failed") {
                    instagramFailedCount += 1;
                    const reason = String(
                        outbound.reasonCode
                        || outbound.failureMessage
                        || "unknown"
                    ).trim().toLowerCase() || "unknown";
                    instagramFailReasonMap.set(reason, (instagramFailReasonMap.get(reason) ?? 0) + 1);
                }
            }

            if (isInstagram) {
                const source = readString(metadata.source).toLowerCase();
                if (source === "human-operator") {
                    humanHandledCount += 1;
                } else {
                    autoReplyCount += 1;
                }

                const threadKey = resolveInstagramThreadKey(message, metadata);
                const inboundAt = pendingInboundByThread.get(threadKey);
                if (inboundAt) {
                    const latency = message.createdAt.getTime() - inboundAt;
                    if (latency >= 0) {
                        responseTimes.push(latency);
                    }
                    pendingInboundByThread.delete(threadKey);
                }

                if (eventType === "instagram-comment") {
                    const mediaId = readString(metadata.mediaId);
                    if (mediaId) {
                        const row = mediaInsightMap.get(mediaId) || { inboundCommentCount: 0, botReplyCount: 0 };
                        if (source !== "human-operator") {
                            row.botReplyCount += 1;
                        }
                        mediaInsightMap.set(mediaId, row);
                    }
                }
            }

            continue;
        }

        if (message.role !== "user" || !isInstagram) {
            continue;
        }

        if (eventType === "instagram-dm") {
            dmCount += 1;
        } else if (eventType === "instagram-comment") {
            commentCount += 1;
            const mediaId = readString(metadata.mediaId);
            if (mediaId) {
                const row = mediaInsightMap.get(mediaId) || { inboundCommentCount: 0, botReplyCount: 0 };
                row.inboundCommentCount += 1;
                mediaInsightMap.set(mediaId, row);
            }
        }

        const skipReason = readString(metadata.autoReplySkippedReason).toLowerCase();
        if (skipReason === "human-operator-replied") {
            humanHandledCount += 1;
        }

        const threadKey = resolveInstagramThreadKey(message, metadata);
        pendingInboundByThread.set(threadKey, message.createdAt.getTime());
    }

    const tokenStats: AnalyticsTokenUsage[] = Array.from(tokenByModel.entries()).map(([model, totalTokens]) => ({
        model,
        totalTokens,
        estimatedCostUsd: Number(((totalTokens / 1_000_000) * 0.1).toFixed(4)),
    }));

    const instagramTotal = instagramSuccessCount + instagramFailedCount;
    const instagramSuccessRate = instagramTotal > 0
        ? Number(((instagramSuccessCount / instagramTotal) * 100).toFixed(2))
        : 0;
    const topFailReasons = Array.from(instagramFailReasonMap.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const avgResponseTimeMs = responseTimes.length > 0
        ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
        : 0;
    const totalReplies = autoReplyCount + humanHandledCount;
    const autoReplyRatio = totalReplies > 0
        ? Number(((autoReplyCount / totalReplies) * 100).toFixed(2))
        : 0;

    const response: AnalyticsSummary = {
        messageVolume: Array.from(volumeMap.entries()).map(([date, count]) => ({ date, count })),
        topTools: toolUsage.map((item) => ({
            toolName: item.toolName,
            count: item._count.toolName,
        })),
        tokenUsage: tokenStats,
        instagramDelivery: {
            successCount: instagramSuccessCount,
            failedCount: instagramFailedCount,
            successRate: instagramSuccessRate,
            topFailReasons,
        },
        instagramKpis: {
            dmCount,
            commentCount,
            avgResponseTimeMs,
            autoReplyCount,
            humanHandledCount,
            autoReplyRatio,
        },
        instagramContentInsights: Array.from(mediaInsightMap.entries())
            .map(([mediaId, value]) => ({
                mediaId,
                inboundCommentCount: value.inboundCommentCount,
                botReplyCount: value.botReplyCount,
            }))
            .sort((a, b) => {
                const left = a.inboundCommentCount + a.botReplyCount;
                const right = b.inboundCommentCount + b.botReplyCount;
                return right - left;
            })
            .slice(0, 10),
    };

    return NextResponse.json(response);
}
