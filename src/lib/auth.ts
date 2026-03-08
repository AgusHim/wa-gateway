import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { TenantRole } from "@prisma/client";
import { authSessionRepo } from "@/lib/db/authSessionRepo";
import { authUserRepo } from "@/lib/db/authUserRepo";
import {
    authenticateTenantUser,
    bootstrapLegacyAdminIfNeeded,
    resolveUserContextOrThrow,
} from "@/lib/auth/tenantAuthService";
import { generateRawToken } from "@/lib/security/token";

type AuthenticatedUser = {
    id: string;
    email: string;
    name?: string | null;
    platformRole: TenantRole;
    membershipRole: TenantRole;
    organizationId: string;
    workspaceId: string;
    sessionVersion: number;
    authSessionToken: string;
};

async function buildAuthenticatedUser(input: {
    id: string;
    email: string;
    name?: string | null;
    platformRole: TenantRole;
    membershipRole: TenantRole;
    organizationId: string;
    workspaceId: string;
    sessionVersion: number;
    userAgent?: string;
    ipAddress?: string;
}): Promise<AuthenticatedUser> {
    const authSessionToken = generateRawToken();

    await authSessionRepo.createSession({
        userId: input.id,
        rawToken: authSessionToken,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
    });

    await authUserRepo.touchLastLogin(input.id);

    return {
        id: input.id,
        email: input.email,
        name: input.name,
        platformRole: input.platformRole,
        membershipRole: input.membershipRole,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        sessionVersion: input.sessionVersion,
        authSessionToken,
    };
}

async function authorizeTenantLogin(
    email: string,
    password: string,
    request: { headers?: Record<string, string | string[] | undefined> } | undefined
): Promise<AuthenticatedUser | null> {
    const requireEmailVerification = process.env.REQUIRE_EMAIL_VERIFICATION === "true";
    let auth = await authenticateTenantUser(email, password);

    if (!auth) {
        await bootstrapLegacyAdminIfNeeded(email, password);
        auth = await authenticateTenantUser(email, password);
    }

    if (!auth) {
        return null;
    }

    if (requireEmailVerification && !auth.user.emailVerifiedAt) {
        return null;
    }

    const userAgentHeader = request?.headers?.["user-agent"];
    const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader;
    const forwardedFor = request?.headers?.["x-forwarded-for"];
    const ipAddress = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;

    return buildAuthenticatedUser({
        id: auth.user.id,
        email: auth.user.email,
        name: auth.user.name,
        platformRole: auth.user.role,
        membershipRole: auth.context.membershipRole,
        organizationId: auth.context.organizationId,
        workspaceId: auth.context.workspaceId,
        sessionVersion: auth.user.sessionVersion,
        userAgent,
        ipAddress,
    });
}

async function authorizeGoogleLogin(email: string): Promise<AuthenticatedUser | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const dbUser = await authUserRepo.findByEmail(normalizedEmail);
    if (!dbUser || !dbUser.isActive) {
        return null;
    }

    const context = resolveUserContextOrThrow(dbUser);
    return buildAuthenticatedUser({
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        platformRole: dbUser.role,
        membershipRole: context.membershipRole,
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        sessionVersion: dbUser.sessionVersion,
    });
}

export const authOptions: NextAuthOptions = {
    session: { strategy: "jwt" },
    pages: {
        signIn: "/login",
    },
    providers: [
        CredentialsProvider({
            name: "Tenant Login",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials, request) {
                const email = credentials?.email?.trim().toLowerCase() || "";
                const password = credentials?.password || "";

                if (!email || !password) {
                    return null;
                }

                return authorizeTenantLogin(email, password, request as { headers?: Record<string, string | string[] | undefined> });
            },
        }),
        ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
            ? [
                GoogleProvider({
                    clientId: process.env.GOOGLE_CLIENT_ID,
                    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                }),
            ]
            : []),
    ],
    callbacks: {
        async signIn({ user, account }) {
            if (account?.provider !== "google") {
                return true;
            }

            const email = user.email?.trim().toLowerCase();
            if (!email) {
                return false;
            }

            const signedInUser = await authorizeGoogleLogin(email);
            if (!signedInUser) {
                return `/signup?email=${encodeURIComponent(email)}`;
            }

            Object.assign(user, signedInUser);
            return true;
        },
        async jwt({ token, user }) {
            if (user) {
                const signedInUser = user as unknown as AuthenticatedUser;
                token.sub = signedInUser.id;
                token.email = signedInUser.email;
                token.name = signedInUser.name || null;
                token.platformRole = signedInUser.platformRole;
                token.membershipRole = signedInUser.membershipRole;
                token.organizationId = signedInUser.organizationId;
                token.workspaceId = signedInUser.workspaceId;
                token.sessionVersion = signedInUser.sessionVersion;
                token.authSessionToken = signedInUser.authSessionToken;
                token.authError = undefined;
                token.lastSessionTouchAt = Date.now();
                return token;
            }

            if (!token.sub || !token.authSessionToken) {
                token.authError = "invalid_session";
                return token;
            }

            const dbUser = await authUserRepo.findById(token.sub);
            if (!dbUser || !dbUser.isActive) {
                token.authError = "user_inactive";
                return token;
            }

            if (dbUser.sessionVersion !== token.sessionVersion) {
                token.authError = "session_revoked";
                return token;
            }

            const activeSession = await authSessionRepo.findActiveSessionByToken(token.sub, token.authSessionToken as string);
            if (!activeSession) {
                token.authError = "session_revoked";
                return token;
            }

            const resolvedContext = resolveUserContextOrThrow(dbUser);
            token.organizationId = resolvedContext.organizationId;
            token.workspaceId = resolvedContext.workspaceId;
            token.membershipRole = resolvedContext.membershipRole;
            token.platformRole = dbUser.role;
            token.email = dbUser.email;
            token.name = dbUser.name || null;
            token.authError = undefined;

            const now = Date.now();
            const lastSessionTouchAt = Number(token.lastSessionTouchAt || 0);
            if (now - lastSessionTouchAt > 5 * 60 * 1000) {
                await authSessionRepo.touchSession(activeSession.id);
                token.lastSessionTouchAt = now;
            }

            return token;
        },
        async session({ session, token }) {
            session.user = {
                ...session.user,
                id: token.sub || "",
                email: token.email || session.user?.email || "",
                name: typeof token.name === "string" ? token.name : session.user?.name || null,
                platformRole: token.platformRole as TenantRole,
                membershipRole: token.membershipRole as TenantRole,
                organizationId: String(token.organizationId || ""),
                workspaceId: String(token.workspaceId || ""),
            };

            if (typeof token.authError === "string") {
                session.error = token.authError;
            }

            return session;
        },
    },
    events: {
        async signOut({ token }) {
            if (!token?.sub || !token?.authSessionToken) {
                return;
            }

            await authSessionRepo.revokeSessionByToken(token.sub, String(token.authSessionToken));
        },
    },
    secret: process.env.NEXTAUTH_SECRET,
};
