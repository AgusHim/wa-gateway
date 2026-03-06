import { withAuth } from "next-auth/middleware";
import { hasTenantPermission, resolveRoutePermission, toTenantRole } from "@/lib/auth/policy";

export default withAuth({
    callbacks: {
        authorized: ({ token, req }) => {
            if (!token || typeof token.authError === "string") {
                return false;
            }

            const membershipRole = toTenantRole(token.membershipRole);
            if (!membershipRole) {
                return false;
            }

            const permission = resolveRoutePermission(req.nextUrl.pathname);
            return hasTenantPermission(membershipRole, permission);
        },
    },
    pages: {
        signIn: "/login",
    },
});

export const config = {
    matcher: [
        "/",
        "/monitor/:path*",
        "/conversations/:path*",
        "/users/:path*",
        "/campaigns/:path*",
        "/knowledge/:path*",
        "/integrations/:path*",
        "/super-admin/:path*",
        "/organization/:path*",
        "/usage/:path*",
        "/config/:path*",
        "/tool-logs/:path*",
        "/analytics/:path*",
        "/qr/:path*",
        "/channels/:path*",
        "/billing/:path*",
        "/team/:path*",
        "/onboarding/:path*",
    ],
};
