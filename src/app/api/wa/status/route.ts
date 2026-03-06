import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import type { WAConnectionStatus } from "@/types/dashboard";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    const auth = await requireApiSession("read");
    if (!auth.ok) {
        return auth.response;
    }

    const selectedChannelId = request.nextUrl.searchParams.get("channelId")?.trim() || "";

    const [{ ensureGatewayBootstrapped }, { getWorkspaceChannelRuntimeStatus }] = await Promise.all([
        import("@/lib/runtime/bootstrapServer"),
        import("@/lib/baileys/client"),
    ]);

    await ensureGatewayBootstrapped();

    const channels = await getWorkspaceChannelRuntimeStatus(auth.context.workspaceId);
    const primary = channels.find((channel) => channel.isPrimary) ?? channels[0] ?? null;
    const selected = selectedChannelId
        ? channels.find((channel) => channel.channelId === selectedChannelId) ?? primary
        : primary;

    const status: WAConnectionStatus = selected?.status ?? "close";

    return NextResponse.json({
        status,
        selectedChannelId: selected?.channelId ?? null,
        primaryChannelId: primary?.channelId ?? null,
        channels: channels.map((channel) => ({
            channelId: channel.channelId,
            name: channel.name,
            provider: channel.provider,
            identifier: channel.identifier,
            status: channel.status,
            isEnabled: channel.isEnabled,
            isPrimary: channel.isPrimary,
            healthStatus: channel.healthStatus,
            healthScore: channel.healthScore,
            rateLimitPerSecond: channel.rateLimitPerSecond,
            qrExpiresAt: channel.qrExpiresAt,
            hasQr: Boolean(channel.qr),
            lastSeenAt: channel.lastSeenAt,
            lastError: channel.lastError,
        })),
    });
}
