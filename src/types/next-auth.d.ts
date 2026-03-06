import { DefaultSession } from "next-auth";
import { TenantRole } from "@prisma/client";

declare module "next-auth" {
    interface Session {
        user: {
            id: string;
            platformRole: TenantRole;
            membershipRole: TenantRole;
            organizationId: string;
            workspaceId: string;
        } & DefaultSession["user"];
        error?: string;
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        platformRole?: TenantRole;
        membershipRole?: TenantRole;
        organizationId?: string;
        workspaceId?: string;
        sessionVersion?: number;
        authSessionToken?: string;
        authError?: string;
        lastSessionTouchAt?: number;
    }
}
