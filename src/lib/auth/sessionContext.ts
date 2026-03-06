import { TenantRole } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasTenantPermission, type TenantPermission } from "@/lib/auth/policy";

export type SessionTenantContext = {
    userId: string;
    organizationId: string;
    workspaceId: string;
    platformRole: TenantRole;
    membershipRole: TenantRole;
};

export async function getSessionTenantContext(): Promise<SessionTenantContext | null> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.user.organizationId || !session.user.workspaceId) {
        return null;
    }

    return {
        userId: session.user.id,
        organizationId: session.user.organizationId,
        workspaceId: session.user.workspaceId,
        platformRole: session.user.platformRole,
        membershipRole: session.user.membershipRole,
    };
}

export async function requireSessionTenantContext(allowedRoles?: TenantRole[]): Promise<SessionTenantContext> {
    const context = await getSessionTenantContext();

    if (!context) {
        throw new Error("Unauthorized");
    }

    if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(context.membershipRole)) {
        throw new Error("Forbidden");
    }

    return context;
}

export async function requireSessionPermission(permission: TenantPermission): Promise<SessionTenantContext> {
    const context = await requireSessionTenantContext();
    if (!hasTenantPermission(context.membershipRole, permission)) {
        throw new Error("Forbidden");
    }

    return context;
}
