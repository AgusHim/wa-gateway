import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { requireApiSession } from "@/lib/auth/apiSession";
import { authSessionRepo } from "@/lib/db/authSessionRepo";
import { authUserRepo } from "@/lib/db/authUserRepo";
import { assertTrustedRouteOrigin } from "@/lib/security/csrf";

export const runtime = "nodejs";

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown): boolean {
    return value === true;
}

export async function GET() {
    const auth = await requireApiSession("read");
    if (!auth.ok) {
        return auth.response;
    }

    const sessions = await authSessionRepo.listActiveSessions(auth.context.userId);
    return NextResponse.json({
        success: true,
        data: {
            sessions,
        },
    });
}

export async function DELETE(request: NextRequest) {
    try {
        assertTrustedRouteOrigin(request);
    } catch {
        return NextResponse.json({ success: false, message: "Invalid request origin" }, { status: 403 });
    }

    const auth = await requireApiSession("read");
    if (!auth.ok) {
        return auth.response;
    }

    let payload: Record<string, unknown> = {};
    try {
        payload = await request.json() as Record<string, unknown>;
    } catch {
        payload = {};
    }

    const sessionId = readString(payload.sessionId);
    const revokeAll = readBoolean(payload.revokeAll);
    const keepCurrent = readBoolean(payload.keepCurrent);

    if (revokeAll) {
        if (keepCurrent) {
            const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
            const rawAuthSessionToken = typeof token?.authSessionToken === "string"
                ? token.authSessionToken
                : "";
            if (!rawAuthSessionToken) {
                return NextResponse.json(
                    {
                        success: false,
                        message: "Current session token not found",
                    },
                    { status: 400 }
                );
            }

            const currentSession = await authSessionRepo.findActiveSessionByToken(auth.context.userId, rawAuthSessionToken);
            if (!currentSession) {
                return NextResponse.json(
                    {
                        success: false,
                        message: "Current session not found",
                    },
                    { status: 400 }
                );
            }

            await authSessionRepo.revokeAllSessions(auth.context.userId, currentSession.id);
        } else {
            await authSessionRepo.revokeAllSessions(auth.context.userId);
            await authUserRepo.incrementSessionVersion(auth.context.userId);
        }

        return NextResponse.json({
            success: true,
            message: "Semua session berhasil direvoke",
        });
    }

    if (!sessionId) {
        return NextResponse.json(
            {
                success: false,
                message: "sessionId or revokeAll is required",
            },
            { status: 400 }
        );
    }

    await authSessionRepo.revokeSessionById(auth.context.userId, sessionId);

    return NextResponse.json({
        success: true,
        message: "Session berhasil direvoke",
    });
}
