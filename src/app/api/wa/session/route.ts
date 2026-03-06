import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/security/apiAuth";
import { channelRepo } from "@/lib/db/channelRepo";

export const runtime = "nodejs";

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: NextRequest) {
    const auth = await authenticateApiRequest(request, {
        requiredScopes: ["wa:session:read"],
        allowAnonymous: false,
    });

    if (!auth.ok) {
        return NextResponse.json(
            {
                success: false,
                message: auth.message,
            },
            { status: auth.status }
        );
    }

    const workspaceId = readString(request.nextUrl.searchParams.get("workspaceId"));
    const channelId = readString(request.nextUrl.searchParams.get("channelId"));

    if (!workspaceId || !channelId) {
        return NextResponse.json(
            {
                success: false,
                message: "workspaceId and channelId are required",
            },
            { status: 400 }
        );
    }

    const channel = await channelRepo.getWorkspaceChannel(workspaceId, channelId);
    if (!channel) {
        return NextResponse.json(
            {
                success: false,
                message: "Channel not found",
            },
            { status: 404 }
        );
    }

    const { sessionRepo } = await import("@/lib/db/sessionRepo");
    const [authState, connectionStatus, latestQr, qrExpiry] = await Promise.all([
        sessionRepo.getSession(`wa:${channelId}:auth-state`),
        sessionRepo.getSession(`wa:${channelId}:connection-status`),
        sessionRepo.getSession(`wa:${channelId}:latest-qr`),
        sessionRepo.getSession(`wa:${channelId}:latest-qr-expiry`),
    ]);

    let parsedAuthState: Record<string, string> | null = null;
    if (authState?.data) {
        try {
            parsedAuthState = JSON.parse(authState.data) as Record<string, string>;
        } catch {
            parsedAuthState = null;
        }
    }

    const audits = await channelRepo.getRecentAudits(channel.id, 30);

    return NextResponse.json({
        success: true,
        data: {
            workspaceId,
            channelId,
            channelName: channel.name,
            connectionStatus: connectionStatus?.data ?? "close",
            hasAuthState: Boolean(authState?.data),
            authStateUpdatedAt: authState?.updatedAt ?? null,
            authFiles: parsedAuthState,
            latestQr: latestQr?.data ?? null,
            qrExpiresAt: qrExpiry?.data ? Number(qrExpiry.data) : null,
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
