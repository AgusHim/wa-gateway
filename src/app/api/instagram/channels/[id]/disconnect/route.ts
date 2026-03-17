import { ChannelHealthStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { isInstagramProvider } from "@/lib/channel/provider";
import { channelRepo } from "@/lib/db/channelRepo";
import { instagramRepo } from "@/lib/integrations/instagram/repo";
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

    if (!isInstagramProvider(channel.provider)) {
        return NextResponse.json(
            {
                success: false,
                message: "Channel provider must be instagram",
            },
            { status: 400 }
        );
    }

    await instagramRepo.clearChannelConnection(auth.context.workspaceId, channel.id);
    await channelRepo.updateHealth(channel.id, {
        healthStatus: ChannelHealthStatus.DISCONNECTED,
        healthScore: 30,
        status: "inactive",
        message: "instagram_disconnected",
    });

    await channelRepo.createAudit(channel.id, {
        eventType: "instagram_oauth_disconnected",
        status: "success",
        message: "manual_disconnect",
    });

    return NextResponse.json({
        success: true,
        message: "Instagram disconnected",
        data: {
            channelId: channel.id,
        },
    });
}
