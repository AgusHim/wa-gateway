import { NextRequest, NextResponse } from "next/server";
import { verifyEmailWithToken } from "@/lib/auth/tenantAuthService";

export const runtime = "nodejs";

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
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

    const token = readString(payload.token);
    if (!token) {
        return NextResponse.json(
            {
                success: false,
                message: "token is required",
            },
            { status: 400 }
        );
    }

    try {
        await verifyEmailWithToken(token);
        return NextResponse.json({
            success: true,
            message: "Email berhasil diverifikasi",
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to verify email";
        return NextResponse.json(
            {
                success: false,
                message,
            },
            { status: 400 }
        );
    }
}
