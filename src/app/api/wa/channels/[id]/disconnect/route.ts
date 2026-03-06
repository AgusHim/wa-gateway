import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { channelRepo } from "@/lib/db/channelRepo";

export const runtime = "nodejs";

export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireApiSession("manage_channel");
    if (!auth.ok) {
        return auth.response;
    }

    const { id } = await params;
    const channel = await channelRepo.getWorkspaceChannel(auth.context.workspaceId, id);
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
    await disconnectWhatsApp(channel.id, { clearSession: false });

    return NextResponse.json({
        success: true,
        message: "Channel disconnected",
        data: {
            channelId: channel.id,
        },
    });
}
