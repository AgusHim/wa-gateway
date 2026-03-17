import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { channelRepo } from "@/lib/db/channelRepo";
import { isInstagramProvider } from "@/lib/channel/provider";
import { beginInstagramChannelConnect } from "@/lib/integrations/instagram/service";

export const runtime = "nodejs";

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export async function POST(
    request: NextRequest,
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

    let payload: Record<string, unknown> = {};
    try {
        payload = await request.json() as Record<string, unknown>;
    } catch {
        payload = {};
    }

    const returnPath = readString(payload.returnPath) || "/channels";

    try {
        const result = await beginInstagramChannelConnect({
            workspaceId: auth.context.workspaceId,
            userId: auth.context.userId,
            channelId: channel.id,
            returnPath,
            origin: request.nextUrl.origin,
        });

        return NextResponse.json({
            success: true,
            message: "Instagram OAuth URL generated",
            data: {
                channelId: channel.id,
                authUrl: result.authUrl,
                state: result.state,
            },
        });
    } catch (error) {
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : "Failed to start Instagram OAuth",
            },
            { status: 500 }
        );
    }
}

