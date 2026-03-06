import { NextRequest, NextResponse } from "next/server";
import { UsageMetric } from "@prisma/client";
import { billingService } from "@/lib/billing/service";
import { channelRepo } from "@/lib/db/channelRepo";
import { getOutboundSendQueue } from "@/lib/queue/messageQueue";
import { requirePublicApiKey } from "@/lib/security/publicApiAuth";
import { evaluateOutboundPolicy } from "@/lib/wa/compliance";
import { generateCorrelationId, generateTraceId } from "@/lib/observability/trace";
import { getWorkspaceRuntimeFlags } from "@/lib/tenant/flags";

export const runtime = "nodejs";

function getStringValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function normalizePhoneIdentifier(raw: string): string {
    const value = raw.trim();
    if (!value) return "";
    if (value.includes("@")) return value;

    const digits = value.replace(/\D/g, "");
    if (!digits) return "";

    if (digits.startsWith("0")) {
        return `62${digits.slice(1)}`;
    }
    if (digits.startsWith("8")) {
        return `62${digits}`;
    }

    return digits;
}

function resolveMode(rawMode: string): "chat" | "broadcast" | "notification" {
    if (rawMode === "broadcast" || rawMode === "notification") {
        return rawMode;
    }

    return "chat";
}

export async function POST(request: NextRequest) {
    const traceId = request.headers.get("x-trace-id")?.trim() || generateTraceId();
    const correlationId = request.headers.get("x-correlation-id")?.trim() || generateCorrelationId();

    const auth = await requirePublicApiKey(request, ["messages:send"]);
    if (!auth.ok) {
        return auth.response;
    }

    let payload: Record<string, unknown>;
    try {
        payload = await request.json() as Record<string, unknown>;
    } catch {
        return NextResponse.json(
            {
                success: false,
                message: "Invalid JSON payload",
            },
            { status: 400 }
        );
    }

    const rawPhoneNumber =
        getStringValue(payload.phoneNumber)
        || getStringValue(payload.phone_number)
        || getStringValue(payload.to);
    const text = getStringValue(payload.text) || getStringValue(payload.message);
    const channelIdPayload = getStringValue(payload.channelId);
    const mode = resolveMode(getStringValue(payload.mode).toLowerCase());
    const templateId = getStringValue(payload.templateId) || undefined;

    if (!rawPhoneNumber) {
        return NextResponse.json(
            {
                success: false,
                message: "phoneNumber is required",
            },
            { status: 400 }
        );
    }

    if (!text) {
        return NextResponse.json(
            {
                success: false,
                message: "text is required",
            },
            { status: 400 }
        );
    }

    if (text.length > 4096) {
        return NextResponse.json(
            {
                success: false,
                message: "text is too long (max 4096 chars)",
            },
            { status: 400 }
        );
    }

    const phoneNumber = normalizePhoneIdentifier(rawPhoneNumber);
    if (!phoneNumber) {
        return NextResponse.json(
            {
                success: false,
                message: "phoneNumber is invalid",
            },
            { status: 400 }
        );
    }

    const workspaceId = auth.context.workspaceId;
    const runtimeFlags = await getWorkspaceRuntimeFlags(workspaceId);
    if (!runtimeFlags.allowOutbound) {
        return NextResponse.json(
            {
                success: false,
                message: "Workspace outbound is disabled",
            },
            { status: 403 }
        );
    }

    const channel = channelIdPayload
        ? await channelRepo.getWorkspaceChannel(workspaceId, channelIdPayload)
        : await channelRepo.getPrimaryWorkspaceChannel(workspaceId);

    if (!channel || !channel.isEnabled || channel.status === "removed") {
        return NextResponse.json(
            {
                success: false,
                message: "No active channel available",
            },
            { status: 400 }
        );
    }

    const policyResult = await evaluateOutboundPolicy({
        workspaceId,
        channelId: channel.id,
        phoneNumber,
        mode,
        templateId,
    });

    if (!policyResult.ok) {
        return NextResponse.json(
            {
                success: false,
                message: policyResult.message || "Outbound policy rejected",
                data: {
                    violations: policyResult.violations,
                },
            },
            { status: 403 }
        );
    }

    const outboundLimit = await billingService.evaluateUsageLimit(workspaceId, UsageMetric.OUTBOUND_MESSAGE, 1);
    if (!outboundLimit.allowed) {
        return NextResponse.json(
            {
                success: false,
                message: "Outbound message limit reached for current billing cycle",
            },
            { status: 402 }
        );
    }

    const [{ ensureGatewayBootstrapped }, { ensureOutboundPartitionWorker }] = await Promise.all([
        import("@/lib/runtime/bootstrapServer"),
        import("@/agent/bootstrap"),
    ]);
    await ensureGatewayBootstrapped();
    ensureOutboundPartitionWorker(workspaceId, channel.id);

    try {
        const queue = getOutboundSendQueue(workspaceId, channel.id);
        const queuedJob = await queue.add(`public-api-send:${channel.id}`, {
            workspaceId,
            channelId: channel.id,
            phoneNumber,
            text,
            mode,
            templateId,
            requestedAt: Date.now(),
            traceId,
            correlationId,
        });

        return NextResponse.json(
            {
                success: true,
                message: "Message queued",
                data: {
                    workspaceId,
                    channelId: channel.id,
                    phoneNumber,
                    mode,
                    jobId: queuedJob.id,
                    traceId,
                    correlationId,
                },
            },
            { status: 202 }
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to queue WhatsApp message";
        return NextResponse.json(
            {
                success: false,
                message,
            },
            { status: 500 }
        );
    }
}
