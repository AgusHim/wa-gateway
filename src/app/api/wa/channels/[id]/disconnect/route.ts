import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { channelRepo } from "@/lib/db/channelRepo";
import { isWhatsAppProvider } from "@/lib/channel/provider";
import { assertTrustedRouteOrigin } from "@/lib/security/csrf";

export const runtime = "nodejs";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        assertTrustedRouteOrigin(request);
    } catch {
        return NextResponse.json({ success: false, message: "Invalid request origin" }, { status: 403 });
    }

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
    if (!isWhatsAppProvider(channel.provider)) {
        return NextResponse.json(
            {
                success: false,
                message: "Disconnect API ini hanya untuk channel provider whatsapp",
            },
            { status: 400 }
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
