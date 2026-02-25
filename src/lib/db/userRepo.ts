import { prisma } from "./client";

export const userRepo = {
    async upsertUser(phoneNumber: string, name?: string) {
        return prisma.user.upsert({
            where: { phoneNumber },
            update: { name: name ?? undefined },
            create: { phoneNumber, name },
        });
    },

    async getUserByPhone(phoneNumber: string) {
        return prisma.user.findUnique({ where: { phoneNumber } });
    },

    async getUserById(id: string) {
        return prisma.user.findUnique({
            where: { id },
            include: { memories: true },
        });
    },

    async blockUser(id: string, isBlocked: boolean) {
        return prisma.user.update({
            where: { id },
            data: { isBlocked },
        });
    },

    async updateLabel(id: string, label: string | null) {
        return prisma.user.update({
            where: { id },
            data: { label },
        });
    },

    async getAllUsers() {
        return prisma.user.findMany({
            orderBy: { updatedAt: "desc" },
            include: {
                _count: { select: { conversations: true } },
            },
        });
    },
};
