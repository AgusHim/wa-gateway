import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "next-auth/middleware";
import { hasTenantPermission, resolveRoutePermission, toTenantRole } from "@/lib/auth/policy";

function buildContentSecurityPolicy(): string {
    const scriptSrc = process.env.NODE_ENV === "production"
        ? "'self' 'unsafe-inline'"
        : "'self' 'unsafe-inline' 'unsafe-eval'";

    return [
        "default-src 'self'",
        `script-src ${scriptSrc}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data: https:",
        "connect-src 'self' https: wss: ws:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ].join("; ");
}

function applySecurityHeaders(request: NextRequest, response: NextResponse) {
    response.headers.set("Content-Security-Policy", buildContentSecurityPolicy());
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    response.headers.set("X-DNS-Prefetch-Control", "off");

    const proto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
    if (proto === "https") {
        response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    return response;
}

const authMiddleware = withAuth(
    function middleware(request) {
        return applySecurityHeaders(request, NextResponse.next());
    },
    {
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
    }
);

export default authMiddleware;

export const config = {
    matcher: [
        "/",
        "/monitor/:path*",
        "/observability/:path*",
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
