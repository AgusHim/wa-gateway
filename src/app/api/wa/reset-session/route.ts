import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { channelRepo } from "@/lib/db/channelRepo";
import { assertTrustedRouteOrigin } from "@/lib/security/csrf";

export const runtime = "nodejs";

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
    try {
        assertTrustedRouteOrigin(request);
    } catch {
        return NextResponse.json({ success: false, message: "Invalid request origin" }, { status: 403 });
    }

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

    const { disconnectWhatsApp, connectToWhatsApp } = await import("@/lib/baileys/client");

    await disconnectWhatsApp(channel.id, { clearSession: true });
    await connectToWhatsApp(channel.id);

    const { ensureOutboundPartitionWorker } = await import("@/agent/bootstrap");
    ensureOutboundPartitionWorker(channel.workspaceId, channel.id);

    return NextResponse.json({
        success: true,
        message: "Session cleared and reconnect started",
        data: {
            channelId: channel.id,
        },
    });
}
