import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { channelRepo } from "@/lib/db/channelRepo";

export const runtime = "nodejs";

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
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

    const channelIdPayload = readString(payload.channelId) || request.nextUrl.searchParams.get("channelId") || "";
    const clearSession = payload.clearSession === true;

    const channel = channelIdPayload
        ? await channelRepo.getWorkspaceChannel(auth.context.workspaceId, channelIdPayload)
        : await channelRepo.getPrimaryWorkspaceChannel(auth.context.workspaceId);

    if (!channel) {
        return NextResponse.json(
            {
                success: false,
                message: "Channel not found",
            },
            { status: 404 }
        );
    }

    const { disconnectWhatsApp } = await import("@/lib/baileys/client");
    await disconnectWhatsApp(channel.id, { clearSession });

    return NextResponse.json({
        success: true,
        message: clearSession
            ? "WhatsApp disconnected and session cleared"
            : "WhatsApp disconnected",
        data: {
            channelId: channel.id,
            clearSession,
        },
    });
}
