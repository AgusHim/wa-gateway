import { NextRequest, NextResponse } from "next/server";
import { acceptOrganizationInvite } from "@/lib/auth/tenantAuthService";

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
    const name = readString(payload.name);
    const password = readString(payload.password);

    if (!token || !name || !password) {
        return NextResponse.json(
            {
                success: false,
                message: "token, name, and password are required",
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
        const result = await acceptOrganizationInvite({
            token,
            name,
            password,
        });

        return NextResponse.json({
            success: true,
            message: "Undangan berhasil diterima",
            data: {
                userId: result.user.id,
                organizationId: result.organizationId,
                workspaceId: result.workspaceId,
                membershipRole: result.membershipRole,
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to accept invite";
        return NextResponse.json(
            {
                success: false,
                message,
            },
            { status: 400 }
        );
    }
}
