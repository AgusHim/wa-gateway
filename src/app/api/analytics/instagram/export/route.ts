import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireApiSession } from "@/lib/auth/apiSession";

export const runtime = "nodejs";

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    return value as Record<string, unknown>;
}

function isInstagramMessage(metadata: Record<string, unknown>): boolean {
    if (readString(metadata.provider).toLowerCase() === "instagram") {
        return true;
    }

    const source = readString(metadata.source).toLowerCase();
    if (source.startsWith("instagram")) {
        return true;
    }

    const eventType = readString(metadata.eventType).toLowerCase();
    return eventType === "instagram-dm" || eventType === "instagram-comment";
}

function parseDateInput(value: string, fallback: Date): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return fallback;
    }

    return date;
}

function normalizeDateRange(request: NextRequest): { dateFrom: Date; dateTo: Date } {
    const now = new Date();
    const fallbackTo = new Date(now);
    fallbackTo.setHours(23, 59, 59, 999);

    const fallbackFrom = new Date(fallbackTo);
    fallbackFrom.setDate(fallbackFrom.getDate() - 6);
    fallbackFrom.setHours(0, 0, 0, 0);

    const rawFrom = request.nextUrl.searchParams.get("dateFrom")?.trim() || "";
    const rawTo = request.nextUrl.searchParams.get("dateTo")?.trim() || "";

    const parsedFrom = parseDateInput(rawFrom, fallbackFrom);
    parsedFrom.setHours(0, 0, 0, 0);

    const parsedTo = parseDateInput(rawTo, fallbackTo);
    parsedTo.setHours(23, 59, 59, 999);

    if (parsedFrom > parsedTo) {
        const normalizedFrom = new Date(parsedTo);
        normalizedFrom.setHours(0, 0, 0, 0);
        return {
            dateFrom: normalizedFrom,
            dateTo: parsedTo,
        };
    }

    const maxRangeDays = 31;
    const rangeMs = parsedTo.getTime() - parsedFrom.getTime();
    const maxRangeMs = maxRangeDays * 24 * 60 * 60 * 1000;
    if (rangeMs > maxRangeMs) {
        const cappedFrom = new Date(parsedTo);
        cappedFrom.setDate(cappedFrom.getDate() - maxRangeDays);
        cappedFrom.setHours(0, 0, 0, 0);
        return {
            dateFrom: cappedFrom,
            dateTo: parsedTo,
        };
    }

    return {
        dateFrom: parsedFrom,
        dateTo: parsedTo,
    };
}

function escapeCsv(value: unknown): string {
    const raw = String(value ?? "");
    if (/[,"\n\r]/.test(raw)) {
        return `"${raw.replace(/"/g, '""')}"`;
    }

    return raw;
}

export async function GET(request: NextRequest) {
    const auth = await requireApiSession("read");
    if (!auth.ok) {
        return auth.response;
    }

    const { workspaceId } = auth.context;
    const { dateFrom, dateTo } = normalizeDateRange(request);
    const channelId = request.nextUrl.searchParams.get("channelId")?.trim() || "";

    const rows = await prisma.message.findMany({
        where: {
            workspaceId,
            createdAt: {
                gte: dateFrom,
                lte: dateTo,
            },
            role: {
                in: ["user", "assistant", "system"],
            },
            metadata: channelId
                ? {
                    path: ["channelId"],
                    equals: channelId,
                }
                : undefined,
        },
        orderBy: {
            createdAt: "asc",
        },
        select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
            metadata: true,
            user: {
                select: {
                    phoneNumber: true,
                    name: true,
                },
            },
        },
    });

    const header = [
        "createdAt",
        "messageId",
        "role",
        "phoneNumber",
        "userName",
        "channelId",
        "source",
        "eventType",
        "threadId",
        "igUserId",
        "igUsername",
        "commentId",
        "mediaId",
        "outboundStatus",
        "outboundExternalId",
        "outboundReasonCode",
        "content",
    ];

    const lines = [header.map(escapeCsv).join(",")];

    for (const row of rows) {
        const metadata = asRecord(row.metadata);
        if (!isInstagramMessage(metadata)) {
            continue;
        }

        const outbound = asRecord(metadata.outboundInstagram);
        lines.push([
            row.createdAt.toISOString(),
            row.id,
            row.role,
            row.user.phoneNumber,
            row.user.name || "",
            readString(metadata.channelId),
            readString(metadata.source),
            readString(metadata.eventType),
            readString(metadata.threadId),
            readString(metadata.igUserId),
            readString(metadata.igUsername),
            readString(metadata.commentId),
            readString(metadata.mediaId),
            readString(outbound.status),
            readString(outbound.externalId),
            readString(outbound.reasonCode),
            row.content,
        ].map(escapeCsv).join(","));
    }

    const fileDate = new Date().toISOString().slice(0, 10);
    return new NextResponse(`${lines.join("\n")}\n`, {
        status: 200,
        headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="instagram-conversations-${fileDate}.csv"`,
            "cache-control": "no-store",
        },
    });
}
