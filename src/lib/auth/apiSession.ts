import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { hasTenantPermission, type TenantPermission, toTenantRole } from "@/lib/auth/policy";
import type { SessionTenantContext } from "@/lib/auth/sessionContext";

type ApiSessionSuccess = {
    ok: true;
    session: Session;
    context: SessionTenantContext;
};

type ApiSessionFailure = {
    ok: false;
    response: NextResponse;
};

export type ApiSessionResult = ApiSessionSuccess | ApiSessionFailure;

export async function requireApiSession(permission?: TenantPermission): Promise<ApiSessionResult> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.user.organizationId || !session.user.workspaceId) {
        return {
            ok: false,
            response: NextResponse.json(
                {
                    success: false,
                    message: "Unauthorized",
                },
                { status: 401 }
            ),
        };
    }

    const platformRole = toTenantRole(session.user.platformRole);
    const membershipRole = toTenantRole(session.user.membershipRole);
    if (!platformRole || !membershipRole) {
        return {
            ok: false,
            response: NextResponse.json(
                {
                    success: false,
                    message: "Unauthorized",
                },
                { status: 401 }
            ),
        };
    }

    if (permission && !hasTenantPermission(membershipRole, permission)) {
        return {
            ok: false,
            response: NextResponse.json(
                {
                    success: false,
                    message: "Forbidden",
                },
                { status: 403 }
            ),
        };
    }

    return {
        ok: true,
        session,
        context: {
            userId: session.user.id,
            organizationId: session.user.organizationId,
            workspaceId: session.user.workspaceId,
            platformRole,
            membershipRole,
        },
    };
}
