import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { channelRepo } from "@/lib/db/channelRepo";

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
