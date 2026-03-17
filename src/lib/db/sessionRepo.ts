import { prisma } from "./client";
import { decryptStoredSessionData, encryptStoredSessionData } from "@/lib/security/sessionCipher";

function mapSessionData<T extends { data: string } | null>(session: T): T {
    if (!session) {
        return session;
    }

    return {
        ...session,
        data: decryptStoredSessionData(session.data),
    };
}

export const sessionRepo = {
    async getSession(id: string) {
        const session = await prisma.session.findUnique({ where: { id } });
        return mapSessionData(session);
    },

    async saveSession(id: string, data: string) {
        return prisma.session.upsert({
            where: { id },
            update: { data: encryptStoredSessionData(data) },
            create: { id, data: encryptStoredSessionData(data) },
        });
    },

    async deleteSession(id: string) {
        return prisma.session.deleteMany({ where: { id } });
    },

    async listSessionsByPrefix(prefix: string) {
        const sessions = await prisma.session.findMany({
            where: {
                id: {
                    startsWith: prefix,
                },
            },
            select: {
                id: true,
                data: true,
            },
        });
        return sessions.map((session) => mapSessionData(session));
    },
};
