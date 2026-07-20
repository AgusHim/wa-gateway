import { NextRequest, NextResponse } from "next/server";
import { ChannelProvider } from "@prisma/client";
import { requireApiSession } from "@/lib/auth/apiSession";
import { assertTrustedRouteOrigin } from "@/lib/security/csrf";
import { channelRepo } from "@/lib/db/channelRepo";
import { messageRepo } from "@/lib/db/messageRepo";
import { userRepo } from "@/lib/db/userRepo";
import { handoverRepo } from "@/lib/handover/repo";
import { getOutboundSendQueue } from "@/lib/queue/messageQueue";
import { generateCorrelationId, generateTraceId } from "@/lib/observability/trace";
import { serializeConversationMessage } from "@/lib/conversations/serialize";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ userId: string; messageId: string }> };

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

export async function POST(request: NextRequest, context: RouteContext) {
    try {
        assertTrustedRouteOrigin(request);
    } catch {
        return NextResponse.json({ success: false, message: "Invalid request origin" }, { status: 403 });
    }

    const auth = await requireApiSession("write");
    if (!auth.ok) return auth.response;

    const { userId, messageId } = await context.params;
    const workspaceId = auth.context.workspaceId;
    const message = await messageRepo.getMessageById(workspaceId, messageId);
    if (!message || message.userId !== userId || message.deliveryStatus !== "failed") {
        return NextResponse.json({ success: false, message: "Failed message not found" }, { status: 404 });
    }

    const metadata = asRecord(message.metadata);
    if (metadata.source !== "human-operator" || metadata.origin !== "dashboard" || !message.channelId) {
        return NextResponse.json({ success: false, message: "Message cannot be retried" }, { status: 409 });
    }

    const [user, channel] = await Promise.all([
        userRepo.getUserById(userId, workspaceId),
        channelRepo.getWorkspaceChannel(workspaceId, message.channelId),
    ]);
    if (!user || !channel || channel.providerType !== ChannelProvider.WHATSAPP || !channel.isEnabled || channel.status === "removed") {
        return NextResponse.json({ success: false, message: "WhatsApp conversation is unavailable" }, { status: 409 });
    }

    const queued = await messageRepo.updateDeliveryStatus({
        workspaceId,
        messageId,
        status: "queued",
    });
    if (!queued) {
        return NextResponse.json({ success: false, message: "Message not found" }, { status: 404 });
    }

    await handoverRepo.markPending({
        workspaceId,
        userId,
        phoneNumber: user.phoneNumber,
        topic: "dashboard_operator_takeover",
        triggeredBy: `dashboard:${auth.context.userId}`,
        lastUserMessage: message.content.slice(0, 500),
    });

    try {
        const [{ ensureGatewayBootstrapped }, { ensureOutboundPartitionWorker }] = await Promise.all([
            import("@/lib/runtime/bootstrapServer"),
            import("@/agent/bootstrap"),
        ]);
        await ensureGatewayBootstrapped();
        ensureOutboundPartitionWorker(workspaceId, channel.id);
        const queue = getOutboundSendQueue(workspaceId, channel.id);
        await queue.add(`dashboard-retry:${channel.id}`, {
            workspaceId,
            channelId: channel.id,
            phoneNumber: user.phoneNumber,
            text: message.content,
            mode: "chat",
            requestedAt: Date.now(),
            sourceMessageId: message.id,
            traceId: generateTraceId(),
            correlationId: generateCorrelationId(),
        }, {
            jobId: `dashboard-retry-${message.id}-${Date.now()}`,
        });
    } catch (error) {
        const failed = await messageRepo.updateDeliveryStatus({
            workspaceId,
            messageId,
            status: "failed",
            errorMessage: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({
            success: false,
            message: "Failed to queue WhatsApp retry",
            data: failed ? serializeConversationMessage(failed) : null,
        }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: serializeConversationMessage(queued) }, { status: 202 });
}
