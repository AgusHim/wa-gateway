import { prisma } from "./client";

type UserFilters = {
    query?: string;
    label?: string;
    dateFrom?: Date;
    dateTo?: Date;
};

function buildUserWhere(filters: UserFilters) {
    const where: Record<string, unknown> = {};

    if (filters.query) {
        where.OR = [
            { name: { contains: filters.query, mode: "insensitive" } },
            { phoneNumber: { contains: filters.query, mode: "insensitive" } },
        ];
    }

    if (filters.label) {
        where.label = filters.label;
    }

    if (filters.dateFrom || filters.dateTo) {
        where.conversations = {
            some: {
                createdAt: {
                    gte: filters.dateFrom,
                    lte: filters.dateTo,
                },
            },
        };
    }

    return where;
}

export const userRepo = {
    async getTotalUsers() {
        return prisma.user.count();
    },

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

    async getDistinctLabels() {
        const labels = await prisma.user.findMany({
            where: { label: { not: null } },
            distinct: ["label"],
            select: { label: true },
            orderBy: { label: "asc" },
        });
        return labels.map((item) => item.label).filter((value): value is string => Boolean(value));
    },

    async getUsersForDashboard(filters: UserFilters = {}) {
        return prisma.user.findMany({
            where: buildUserWhere(filters),
            orderBy: { updatedAt: "desc" },
            include: {
                _count: { select: { conversations: true } },
                conversations: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                },
            },
        });
    },
};
