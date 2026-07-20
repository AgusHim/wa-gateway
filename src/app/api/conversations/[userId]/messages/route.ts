import { NextRequest, NextResponse } from "next/server";
import { ChannelProvider, Prisma, UsageMetric } from "@prisma/client";
import { requireApiSession } from "@/lib/auth/apiSession";
import { assertTrustedRouteOrigin } from "@/lib/security/csrf";
import { userRepo } from "@/lib/db/userRepo";
import { channelRepo } from "@/lib/db/channelRepo";
import { messageRepo } from "@/lib/db/messageRepo";
import { handoverRepo } from "@/lib/handover/repo";
import { billingService } from "@/lib/billing/service";
import { evaluateOutboundPolicy } from "@/lib/wa/compliance";
import { getWorkspaceRuntimeFlags } from "@/lib/tenant/flags";
import { getOutboundSendQueue } from "@/lib/queue/messageQueue";
import { generateCorrelationId, generateTraceId } from "@/lib/observability/trace";
import { serializeConversationMessage } from "@/lib/conversations/serialize";
import {
    isValidIdempotencyKey,
    parseConversationLimit,
    readRequiredString,
} from "@/lib/conversations/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ userId: string }> };

async function resolveConversation(workspaceId: string, userId: string, channelId: string) {
    const [user, channel] = await Promise.all([
        userRepo.getUserById(userId, workspaceId),
        channelRepo.getWorkspaceChannel(workspaceId, channelId),
    ]);
    if (!user) return { error: "Conversation user not found", status: 404 } as const;
    if (!channel || channel.providerType !== ChannelProvider.WHATSAPP || channel.status === "removed") {
        return { error: "WhatsApp channel not found", status: 404 } as const;
    }
    return { user, channel } as const;
}

export async function GET(request: NextRequest, context: RouteContext) {
    const auth = await requireApiSession("read");
    if (!auth.ok) return auth.response;

    const { userId } = await context.params;
    const channelId = request.nextUrl.searchParams.get("channelId")?.trim() || "";
    if (!channelId) {
        return NextResponse.json({ success: false, message: "channelId is required" }, { status: 400 });
    }

    const resolved = await resolveConversation(auth.context.workspaceId, userId, channelId);
    if ("error" in resolved) {
        return NextResponse.json({ success: false, message: resolved.error }, { status: resolved.status });
    }

    const page = await messageRepo.getConversationPage({
        workspaceId: auth.context.workspaceId,
        userId,
        channelId,
        cursor: request.nextUrl.searchParams.get("cursor")?.trim() || undefined,
        limit: parseConversationLimit(request.nextUrl.searchParams.get("limit")),
    });
    const handoverPending = await handoverRepo.isPending(resolved.user.phoneNumber, auth.context.workspaceId);

    return NextResponse.json({
        success: true,
        data: {
            messages: page.messages.map(serializeConversationMessage),
            nextCursor: page.nextCursor,
            handoverPending,
        },
    });
}

export async function POST(request: NextRequest, context: RouteContext) {
    try {
        assertTrustedRouteOrigin(request);
    } catch {
        return NextResponse.json({ success: false, message: "Invalid request origin" }, { status: 403 });
    }

    const auth = await requireApiSession("write");
    if (!auth.ok) return auth.response;

    let payload: Record<string, unknown>;
    try {
        payload = await request.json() as Record<string, unknown>;
    } catch {
        return NextResponse.json({ success: false, message: "Invalid JSON payload" }, { status: 400 });
    }

    const { userId } = await context.params;
    const channelId = readRequiredString(payload.channelId);
    const text = readRequiredString(payload.text);
    const idempotencyKey = readRequiredString(payload.idempotencyKey);
    if (!channelId || !text || !idempotencyKey) {
        return NextResponse.json({ success: false, message: "channelId, text, and idempotencyKey are required" }, { status: 400 });
    }
    if (text.length > 4096) {
        return NextResponse.json({ success: false, message: "text is too long (max 4096 chars)" }, { status: 400 });
    }
    if (!isValidIdempotencyKey(idempotencyKey)) {
        return NextResponse.json({ success: false, message: "idempotencyKey is invalid" }, { status: 400 });
    }

    const workspaceId = auth.context.workspaceId;
    const resolved = await resolveConversation(workspaceId, userId, channelId);
    if ("error" in resolved) {
        return NextResponse.json({ success: false, message: resolved.error }, { status: resolved.status });
    }
    if (!resolved.channel.isEnabled) {
        return NextResponse.json({ success: false, message: "WhatsApp channel is disabled" }, { status: 409 });
    }

    const existing = await messageRepo.getMessageByIdempotencyKey(workspaceId, idempotencyKey);
    if (existing) {
        if (existing.userId !== userId || existing.channelId !== channelId || existing.content !== text) {
            return NextResponse.json({ success: false, message: "idempotencyKey already used for another message" }, { status: 409 });
        }
        return NextResponse.json({ success: true, data: serializeConversationMessage(existing) }, { status: 200 });
    }

    const runtimeFlags = await getWorkspaceRuntimeFlags(workspaceId);
    if (!runtimeFlags.allowOutbound) {
        return NextResponse.json({ success: false, message: "Workspace outbound is disabled" }, { status: 403 });
    }
    const policy = await evaluateOutboundPolicy({
        workspaceId,
        channelId,
        phoneNumber: resolved.user.phoneNumber,
        mode: "chat",
    });
    if (!policy.ok) {
        return NextResponse.json({ success: false, message: policy.message || "Outbound policy rejected" }, { status: 403 });
    }
    const usage = await billingService.evaluateUsageLimit(workspaceId, UsageMetric.OUTBOUND_MESSAGE, 1);
    if (!usage.allowed) {
        return NextResponse.json({ success: false, message: "Outbound message limit reached" }, { status: 402 });
    }

    let message;
    try {
        message = await messageRepo.saveMessage({
            workspaceId,
            userId,
            channelId,
            role: "assistant",
            content: text,
            deliveryStatus: "queued",
            idempotencyKey,
            metadata: {
                source: "human-operator",
                origin: "dashboard",
                provider: "whatsapp",
                channelId,
                operatorUserId: auth.context.userId,
            },
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            const duplicate = await messageRepo.getMessageByIdempotencyKey(workspaceId, idempotencyKey);
            if (duplicate) {
                return NextResponse.json({ success: true, data: serializeConversationMessage(duplicate) }, { status: 200 });
            }
        }
        throw error;
    }

    await handoverRepo.markPending({
        workspaceId,
        userId,
        phoneNumber: resolved.user.phoneNumber,
        topic: "dashboard_operator_takeover",
        triggeredBy: `dashboard:${auth.context.userId}`,
        lastUserMessage: text.slice(0, 500),
    });

    try {
        const [{ ensureGatewayBootstrapped }, { ensureOutboundPartitionWorker }] = await Promise.all([
            import("@/lib/runtime/bootstrapServer"),
            import("@/agent/bootstrap"),
        ]);
        await ensureGatewayBootstrapped();
        ensureOutboundPartitionWorker(workspaceId, channelId);

        const traceId = generateTraceId();
        const correlationId = generateCorrelationId();
        const queue = getOutboundSendQueue(workspaceId, channelId);
        await queue.add(`dashboard-reply:${channelId}`, {
            workspaceId,
            channelId,
            phoneNumber: resolved.user.phoneNumber,
            text,
            mode: "chat",
            requestedAt: Date.now(),
            sourceMessageId: message.id,
            traceId,
            correlationId,
        }, {
            jobId: `dashboard-${message.id}`,
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const failed = await messageRepo.updateDeliveryStatus({
            workspaceId,
            messageId: message.id,
            status: "failed",
            errorMessage,
        });
        return NextResponse.json({
            success: false,
            message: "Failed to queue WhatsApp reply",
            data: failed ? serializeConversationMessage(failed) : null,
        }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: serializeConversationMessage(message) }, { status: 202 });
}
