import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireApiSession } from "@/lib/auth/apiSession";
import { toolLogRepo } from "@/lib/db/toolLogRepo";
import type { AnalyticsSummary, AnalyticsTokenUsage } from "@/types/dashboard";

export const runtime = "nodejs";

function toDayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function readNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    return value as Record<string, unknown>;
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

    const [messages, toolUsage, assistantMessages] = await Promise.all([
        prisma.message.findMany({
            where: {
                workspaceId,
                createdAt: { gte: start },
            },
            select: { createdAt: true },
            orderBy: { createdAt: "asc" },
        }),
        toolLogRepo.getToolUsageSummary(workspaceId),
        prisma.message.findMany({
            where: {
                workspaceId,
                role: "assistant",
                createdAt: { gte: start },
            },
            select: { metadata: true },
        }),
    ]);

    const volumeMap = new Map<string, number>();
    for (let i = 0; i < days; i++) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        volumeMap.set(toDayKey(date), 0);
    }

    for (const message of messages) {
        const key = toDayKey(message.createdAt);
        volumeMap.set(key, (volumeMap.get(key) ?? 0) + 1);
    }

    const tokenByModel = new Map<string, number>();
    for (const message of assistantMessages) {
        const metadata = asRecord(message.metadata);
        if (!metadata) {
            continue;
        }

        const model = String(metadata.model ?? metadata.modelName ?? "unknown");
        const tokenCount =
            readNumber(metadata.totalTokens)
            || readNumber(metadata.tokensTotal)
            || (readNumber(metadata.inputTokens) + readNumber(metadata.outputTokens));

        if (tokenCount > 0) {
            tokenByModel.set(model, (tokenByModel.get(model) ?? 0) + tokenCount);
        }
    }

    const tokenStats: AnalyticsTokenUsage[] = Array.from(tokenByModel.entries()).map(([model, totalTokens]) => ({
        model,
        totalTokens,
        estimatedCostUsd: Number(((totalTokens / 1_000_000) * 0.1).toFixed(4)),
    }));

    const response: AnalyticsSummary = {
        messageVolume: Array.from(volumeMap.entries()).map(([date, count]) => ({ date, count })),
        topTools: toolUsage.map((item) => ({
            toolName: item.toolName,
            count: item._count.toolName,
        })),
        tokenUsage: tokenStats,
    };

    return NextResponse.json(response);
}
