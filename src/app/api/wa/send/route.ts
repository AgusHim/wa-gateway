import { NextRequest, NextResponse } from "next/server";

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

function isAuthorized(request: NextRequest): boolean {
    const expectedApiKey = (process.env.WA_GATEWAY_API_KEY || "").trim();
    if (!expectedApiKey) return true;

    const headerApiKey = (request.headers.get("x-api-key") || "").trim();
    const authHeader = (request.headers.get("authorization") || "").trim();
    const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : "";

    return headerApiKey === expectedApiKey || bearerToken === expectedApiKey;
}

export async function POST(request: NextRequest) {
    if (!isAuthorized(request)) {
        return NextResponse.json(
            {
                success: false,
                message: "Unauthorized",
            },
            { status: 401 }
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

    const rawPhoneNumber =
        getStringValue(payload.phoneNumber) ||
        getStringValue(payload.phone_number) ||
        getStringValue(payload.to);
    const text = getStringValue(payload.text) || getStringValue(payload.message);

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

    const [{ ensureGatewayBootstrapped }, { sendMessage, sendTyping }] = await Promise.all([
        import("@/lib/runtime/bootstrapServer"),
        import("@/lib/baileys/client"),
    ]);

    await ensureGatewayBootstrapped();

    try {
        await sendTyping(phoneNumber, text.length);
        await sendMessage(phoneNumber, text, { withTyping: false });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to send WhatsApp message";
        const isDisconnected = message.includes("Socket not connected");

        return NextResponse.json(
            {
                success: false,
                message,
            },
            { status: isDisconnected ? 503 : 500 }
        );
    }

    return NextResponse.json({
        success: true,
        message: "Message sent",
        data: {
            phoneNumber,
        },
    });
}
