import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { replayInstagramWebhookEvent } from "@/lib/integrations/instagram/webhookIngestion";

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

    const eventId = readString(payload.eventId);
    if (!eventId) {
        return NextResponse.json(
            {
                success: false,
                message: "eventId is required",
            },
            { status: 400 }
        );
    }

    const result = await replayInstagramWebhookEvent({
        workspaceId: auth.context.workspaceId,
        eventId,
    });

    if (!result.queued) {
        return NextResponse.json(
            {
                success: false,
                message: result.reason || "Failed to replay event",
            },
            { status: 404 }
        );
    }

    return NextResponse.json({
        success: true,
        message: "Instagram webhook event replayed",
        data: {
            eventId,
        },
    });
}
