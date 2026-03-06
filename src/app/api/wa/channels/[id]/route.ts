import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { channelRepo, type ChannelSendPolicy } from "@/lib/db/channelRepo";

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

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireApiSession("manage_channel");
    if (!auth.ok) {
        return auth.response;
    }

    const { id } = await params;
    const existing = await channelRepo.getWorkspaceChannel(auth.context.workspaceId, id);
    if (!existing) {
        return NextResponse.json(
            {
                success: false,
                message: "Channel not found",
            },
            { status: 404 }
        );
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
    const identifier = payload.identifier === null ? null : readString(payload.identifier);
    const status = readString(payload.status);

    const rateLimitPerSecondRaw = Number(payload.rateLimitPerSecond);
    const rateLimitPerSecond = Number.isFinite(rateLimitPerSecondRaw)
        ? Math.max(1, Math.min(100, Math.round(rateLimitPerSecondRaw)))
        : undefined;

    const updated = await channelRepo.updateChannel(id, {
        name: name || undefined,
        identifier: payload.identifier !== undefined ? identifier : undefined,
        isEnabled: typeof payload.isEnabled === "boolean" ? payload.isEnabled : undefined,
        isPrimary: typeof payload.isPrimary === "boolean" ? payload.isPrimary : undefined,
        rateLimitPerSecond,
        policy: payload.policy !== undefined ? readPolicy(payload.policy) : undefined,
        status: status || undefined,
    });

    if (updated.isEnabled) {
        const [{ ensureInboundPartitionWorker, ensureOutboundPartitionWorker }, { ensureGatewayBootstrapped }, { connectToWhatsApp }] = await Promise.all([
            import("@/agent/bootstrap"),
            import("@/lib/runtime/bootstrapServer"),
            import("@/lib/baileys/client"),
        ]);

        await ensureGatewayBootstrapped();
        ensureInboundPartitionWorker(auth.context.workspaceId, updated.id);
        ensureOutboundPartitionWorker(auth.context.workspaceId, updated.id);
        await connectToWhatsApp(updated.id);
    }

    return NextResponse.json({
        success: true,
        message: "Channel updated",
        data: updated,
    });
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireApiSession("manage_channel");
    if (!auth.ok) {
        return auth.response;
    }

    const { id } = await params;
    const existing = await channelRepo.getWorkspaceChannel(auth.context.workspaceId, id);
    if (!existing) {
        return NextResponse.json(
            {
                success: false,
                message: "Channel not found",
            },
            { status: 404 }
        );
    }

    const { disconnectWhatsApp } = await import("@/lib/baileys/client");
    await disconnectWhatsApp(existing.id, { clearSession: true });

    const removed = await channelRepo.softDeleteChannel(existing.id);

    return NextResponse.json({
        success: true,
        message: "Channel removed",
        data: removed,
    });
}
