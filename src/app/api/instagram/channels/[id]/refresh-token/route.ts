import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { channelRepo } from "@/lib/db/channelRepo";
import { isInstagramProvider } from "@/lib/channel/provider";
import { refreshInstagramChannelToken } from "@/lib/integrations/instagram/service";
import { instagramRepo } from "@/lib/integrations/instagram/repo";

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

    if (!isInstagramProvider(channel.provider)) {
        return NextResponse.json(
            {
                success: false,
                message: "Channel provider must be instagram",
            },
            { status: 400 }
        );
    }

    try {
        await refreshInstagramChannelToken({
            workspaceId: auth.context.workspaceId,
            channelId: channel.id,
            triggeredBy: "manual",
            createdByUserId: auth.context.userId,
        });

        const binding = await instagramRepo.getChannelBinding(auth.context.workspaceId, channel.id);

        return NextResponse.json({
            success: true,
            message: "Instagram token refreshed",
            data: {
                channelId: channel.id,
                binding,
            },
        });
    } catch (error) {
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : "Failed to refresh Instagram token",
            },
            { status: 500 }
        );
    }
}

