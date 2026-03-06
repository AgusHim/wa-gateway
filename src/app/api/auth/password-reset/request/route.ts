import { NextRequest, NextResponse } from "next/server";
import { createPasswordResetToken } from "@/lib/auth/tenantAuthService";
import { sendTenantEmail } from "@/lib/notifications/email";

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

    const email = readString(payload.email).toLowerCase();
    if (!email) {
        return NextResponse.json(
            {
                success: false,
                message: "email is required",
            },
            { status: 400 }
        );
    }

    const tokenData = await createPasswordResetToken(email);
    if (tokenData) {
        const appUrl = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
        const resetLink = `${appUrl}/reset-password?token=${encodeURIComponent(tokenData.rawToken)}`;

        await sendTenantEmail({
            to: email,
            subject: "Reset password WA Gateway",
            text: `Silakan reset password Anda melalui link berikut: ${resetLink}`,
        });

        return NextResponse.json({
            success: true,
            message: "Jika email terdaftar, link reset password telah dikirim.",
            data: {
                resetLinkPreview: process.env.NODE_ENV === "production" ? undefined : resetLink,
            },
        });
    }

    return NextResponse.json({
        success: true,
        message: "Jika email terdaftar, link reset password telah dikirim.",
    });
}
