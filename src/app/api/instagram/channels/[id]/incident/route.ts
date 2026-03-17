import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { getInstagramChannelIncidentSnapshot } from "@/lib/integrations/instagram/incident";

export const runtime = "nodejs";

function readPositiveInteger(value: string | null | undefined): number | undefined {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }

    return Math.max(1, Math.round(parsed));
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireApiSession("manage_channel");
    if (!auth.ok) {
        return auth.response;
    }

    const { id } = await params;

    try {
        const data = await getInstagramChannelIncidentSnapshot({
            workspaceId: auth.context.workspaceId,
            channelId: id,
            auditLimit: readPositiveInteger(request.nextUrl.searchParams.get("auditLimit")),
            messageLimit: readPositiveInteger(request.nextUrl.searchParams.get("messageLimit")),
        });

        return NextResponse.json({
            success: true,
            data,
        });
    } catch (error) {
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : "Failed to load Instagram incident snapshot",
            },
            { status: 400 }
        );
    }
}
