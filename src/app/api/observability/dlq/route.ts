import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { listWorkspaceDeadLetters, replayWorkspaceDeadLetter } from "@/lib/observability/deadLetter";

export const runtime = "nodejs";

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function readLimit(request: NextRequest): number {
    const raw = Number(request.nextUrl.searchParams.get("limit"));
    if (!Number.isFinite(raw)) {
        return 50;
    }
    return Math.max(1, Math.min(200, Math.round(raw)));
}

export async function GET(request: NextRequest) {
    const auth = await requireApiSession("read");
    if (!auth.ok) {
        return auth.response;
    }

    const limit = readLimit(request);
    const snapshot = await listWorkspaceDeadLetters(auth.context.workspaceId, limit);

    return NextResponse.json({
        success: true,
        data: snapshot,
    });
}

export async function POST(request: NextRequest) {
    const auth = await requireApiSession("manage_channel");
    if (!auth.ok) {
        return auth.response;
    }

    let payload: Record<string, unknown> = {};
    try {
        payload = await request.json() as Record<string, unknown>;
    } catch {
        payload = {};
    }

    const direction = readString(payload.direction).toLowerCase();
    const dlqJobId = readString(payload.dlqJobId);

    if (!dlqJobId || (direction !== "inbound" && direction !== "outbound")) {
        return NextResponse.json(
            {
                success: false,
                message: "direction (inbound|outbound) dan dlqJobId wajib diisi",
            },
            { status: 400 }
        );
    }

    const channelId = readString(payload.channelId);
    try {
        const result = await replayWorkspaceDeadLetter({
            workspaceId: auth.context.workspaceId,
            direction,
            dlqJobId,
            channelId: channelId || undefined,
        });

        return NextResponse.json({
            success: true,
            message: `${direction === "inbound" ? "Inbound" : "Outbound"} DLQ job di-replay`,
            data: result,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Gagal replay DLQ job";
        const status = message === "DLQ job tidak ditemukan"
            ? 404
            : message === "DLQ job bukan milik workspace ini"
                ? 403
                : message === "Channel tidak ditemukan"
                    ? 404
                    : message === "channelId wajib diisi untuk replay outbound"
                        ? 400
                        : 400;

        return NextResponse.json({ success: false, message }, { status });
    }
}
