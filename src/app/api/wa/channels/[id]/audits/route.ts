import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { channelRepo } from "@/lib/db/channelRepo";

export const runtime = "nodejs";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireApiSession("read");
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

    const limitRaw = Number(request.nextUrl.searchParams.get("limit") || 20);
    const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(100, Math.round(limitRaw)))
        : 20;

    const audits = await channelRepo.getRecentAudits(channel.id, limit);

    return NextResponse.json({
        success: true,
        data: {
            channelId: channel.id,
            audits: audits.map((audit) => ({
                id: audit.id,
                eventType: audit.eventType,
                status: audit.status,
                message: audit.message,
                metadata: audit.metadata,
                createdAt: audit.createdAt,
            })),
        },
    });
}
