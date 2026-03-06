import { NextRequest, NextResponse } from "next/server";
import { resetPasswordWithToken } from "@/lib/auth/tenantAuthService";

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
    const password = readString(payload.password);

    if (!token || !password) {
        return NextResponse.json(
            {
                success: false,
                message: "token and password are required",
            },
            { status: 400 }
        );
    }

    if (password.length < 8) {
        return NextResponse.json(
            {
                success: false,
                message: "Password minimal 8 karakter",
            },
            { status: 400 }
        );
    }

    try {
        await resetPasswordWithToken(token, password);
        return NextResponse.json({
            success: true,
            message: "Password berhasil diperbarui",
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to reset password";
        return NextResponse.json(
            {
                success: false,
                message,
            },
            { status: 400 }
        );
    }
}
