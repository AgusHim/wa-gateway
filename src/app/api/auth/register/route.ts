import { NextRequest, NextResponse } from "next/server";
import {
    createEmailVerificationToken,
    registerOwnerWithOrganization,
} from "@/lib/auth/tenantAuthService";
import { authUserRepo } from "@/lib/db/authUserRepo";
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

    const name = readString(payload.name);
    const email = readString(payload.email).toLowerCase();
    const password = readString(payload.password);
    const organizationName = readString(payload.organizationName);
    const workspaceName = readString(payload.workspaceName);

    if (!name || !email || !password || !organizationName || !workspaceName) {
        return NextResponse.json(
            {
                success: false,
                message: "name, email, password, organizationName, and workspaceName are required",
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
        const requireEmailVerification = process.env.REQUIRE_EMAIL_VERIFICATION === "true";
        const { user } = await registerOwnerWithOrganization({
            name,
            email,
            password,
            organizationName,
            workspaceName,
        });

        let verificationLink: string | undefined;
        if (requireEmailVerification) {
            const { rawToken } = await createEmailVerificationToken(user.id, user.email);
            const appUrl = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
            verificationLink = `${appUrl}/verify-email?token=${encodeURIComponent(rawToken)}`;

            await sendTenantEmail({
                to: user.email,
                subject: "Verifikasi email akun WA Gateway",
                text: `Silakan verifikasi email Anda melalui link berikut: ${verificationLink}`,
            });
        } else {
            await authUserRepo.markEmailVerified(user.id);
        }

        return NextResponse.json({
            success: true,
            message: requireEmailVerification
                ? "Registrasi berhasil. Cek email untuk verifikasi akun."
                : "Registrasi berhasil. Silakan login.",
            data: {
                requiresEmailVerification: requireEmailVerification,
                verificationLinkPreview: requireEmailVerification && process.env.NODE_ENV !== "production"
                    ? verificationLink
                    : undefined,
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to register user";
        return NextResponse.json(
            {
                success: false,
                message,
            },
            { status: 400 }
        );
    }
}
