import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { billingService } from "@/lib/billing/service";
import { channelRepo, type ChannelSendPolicy } from "@/lib/db/channelRepo";
import { parseChannelProvider } from "@/lib/channel/provider";

export const runtime = "nodejs";

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function readStringList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) {
        return value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
}

function toRecord(value: unknown): Record<string, unknown> {
    return (typeof value === "object" && value !== null)
        ? value as Record<string, unknown>
        : {};
}

function readPolicy(payload: unknown): ChannelSendPolicy {
    const source = toRecord(payload);

    return {
        allowlist: readStringList(source.allowlist),
        denylist: readStringList(source.denylist),
        allowedCountryPrefixes: readStringList(source.allowedCountryPrefixes),
        requireTemplateForBroadcast: source.requireTemplateForBroadcast === true,
        allowedTemplatePrefixes: readStringList(source.allowedTemplatePrefixes),
    };
}

export async function GET() {
    const auth = await requireApiSession("read");
    if (!auth.ok) {
        return auth.response;
    }

    const { getWorkspaceChannelRuntimeStatus } = await import("@/lib/baileys/client");
    const channels = await getWorkspaceChannelRuntimeStatus(auth.context.workspaceId);

    return NextResponse.json({
        success: true,
        data: {
            workspaceId: auth.context.workspaceId,
            channels,
        },
    });
}

export async function POST(request: NextRequest) {
    const auth = await requireApiSession("manage_channel");
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

    const name = readString(payload.name);
    const identifier = readString(payload.identifier);
    const providerRaw = payload.provider !== undefined ? readString(payload.provider) : "whatsapp";
    const provider = parseChannelProvider(providerRaw);
    if (!provider) {
        return NextResponse.json(
            {
                success: false,
                message: "provider is invalid. allowed: whatsapp, instagram",
            },
            { status: 400 }
        );
    }
    const isPrimary = payload.isPrimary === true;
    const autoConnect = payload.autoConnect !== false;

    const rateLimitPerSecondRaw = Number(payload.rateLimitPerSecond);
    const rateLimitPerSecond = Number.isFinite(rateLimitPerSecondRaw)
        ? Math.max(1, Math.min(100, Math.round(rateLimitPerSecondRaw)))
        : 5;

    if (!name) {
        return NextResponse.json(
            {
                success: false,
                message: "name is required",
            },
            { status: 400 }
        );
    }

    const billingSnapshot = await billingService.getBillingSnapshot(auth.context.workspaceId);
    if (billingSnapshot.usage.channels.used >= billingSnapshot.usage.channels.limit) {
        return NextResponse.json(
            {
                success: false,
                message: "Channel limit reached for current plan",
            },
            { status: 402 }
        );
    }

    const channel = await channelRepo.createChannel({
        workspaceId: auth.context.workspaceId,
        name,
        provider,
        identifier: identifier || undefined,
        rateLimitPerSecond,
        policy: readPolicy(payload),
        isPrimary,
    });

    if (autoConnect && provider === "whatsapp") {
        const [{ connectToWhatsApp }, { ensureInboundPartitionWorker, ensureOutboundPartitionWorker }, { ensureGatewayBootstrapped }] = await Promise.all([
            import("@/lib/baileys/client"),
            import("@/agent/bootstrap"),
            import("@/lib/runtime/bootstrapServer"),
        ]);
        await ensureGatewayBootstrapped();
        ensureInboundPartitionWorker(auth.context.workspaceId, channel.id);
        ensureOutboundPartitionWorker(auth.context.workspaceId, channel.id);
        await connectToWhatsApp(channel.id);
    }

    return NextResponse.json({
        success: true,
        message: "Channel created",
        data: channel,
    });
}
