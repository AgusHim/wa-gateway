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
                message: "Reset API ini hanya untuk channel provider whatsapp",
            },
            { status: 400 }
        );
    }

    const [{ disconnectWhatsApp, connectToWhatsApp }, { ensureGatewayBootstrapped }, { ensureInboundPartitionWorker, ensureOutboundPartitionWorker }] = await Promise.all([
        import("@/lib/baileys/client"),
        import("@/lib/runtime/bootstrapServer"),
        import("@/agent/bootstrap"),
    ]);

    await ensureGatewayBootstrapped();
    ensureInboundPartitionWorker(auth.context.workspaceId, channel.id);
    ensureOutboundPartitionWorker(auth.context.workspaceId, channel.id);
    await disconnectWhatsApp(channel.id, { clearSession: true });
    await connectToWhatsApp(channel.id);

    return NextResponse.json({
        success: true,
        message: "Channel session reset initiated",
        data: {
            channelId: channel.id,
        },
    });
}
