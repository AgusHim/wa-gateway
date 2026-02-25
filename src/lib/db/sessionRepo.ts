import { prisma } from "./client";

export const sessionRepo = {
    async getSession(id: string) {
        return prisma.session.findUnique({ where: { id } });
    },

    async saveSession(id: string, data: string) {
        return prisma.session.upsert({
            where: { id },
            update: { data },
            create: { id, data },
        });
    },

    async deleteSession(id: string) {
        return prisma.session.deleteMany({ where: { id } });
    },
};
