import { prisma } from "./client";
import { hashToken } from "@/lib/security/token";

const DEFAULT_SESSION_TTL_DAYS = 30;

function calculateExpiry(ttlDays: number = DEFAULT_SESSION_TTL_DAYS): Date {
    return new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
}

export const authSessionRepo = {
    async createSession(input: {
        userId: string;
        rawToken: string;
        userAgent?: string;
        ipAddress?: string;
        ttlDays?: number;
    }) {
        return prisma.authSession.create({
            data: {
                userId: input.userId,
                sessionTokenHash: hashToken(input.rawToken),
                userAgent: input.userAgent,
                ipAddress: input.ipAddress,
                expiresAt: calculateExpiry(input.ttlDays),
            },
        });
    },

    async findActiveSessionByToken(userId: string, rawToken: string) {
        return prisma.authSession.findFirst({
            where: {
                userId,
                sessionTokenHash: hashToken(rawToken),
                revokedAt: null,
                expiresAt: { gt: new Date() },
            },
        });
    },

    async touchSession(id: string) {
        return prisma.authSession.update({
            where: { id },
            data: { lastSeenAt: new Date() },
        });
    },

    async listActiveSessions(userId: string) {
        return prisma.authSession.findMany({
            where: {
                userId,
                revokedAt: null,
                expiresAt: { gt: new Date() },
            },
            orderBy: { updatedAt: "desc" },
            select: {
                id: true,
                userAgent: true,
                ipAddress: true,
                lastSeenAt: true,
                expiresAt: true,
                createdAt: true,
            },
        });
    },

    async revokeSessionByToken(userId: string, rawToken: string) {
        return prisma.authSession.updateMany({
            where: {
                userId,
                sessionTokenHash: hashToken(rawToken),
                revokedAt: null,
            },
            data: { revokedAt: new Date() },
        });
    },

    async revokeSessionById(userId: string, sessionId: string) {
        return prisma.authSession.updateMany({
            where: {
                id: sessionId,
                userId,
                revokedAt: null,
            },
            data: { revokedAt: new Date() },
        });
    },

    async revokeAllSessions(userId: string, exceptSessionId?: string) {
        return prisma.authSession.updateMany({
            where: {
                userId,
                revokedAt: null,
                ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
            },
            data: { revokedAt: new Date() },
        });
    },
};
