import { prisma } from "./client";
import { Prisma } from "@prisma/client";
import { assertTenantScope } from "@/lib/tenant/context";

export type DashboardUserFilters = {
    query?: string;
    label?: string;
    dateFrom?: Date;
    dateTo?: Date;
    channelId?: string;
};

const userDetailInclude = Prisma.validator<Prisma.ChatUserInclude>()({
    memories: true,
});

const userCountInclude = Prisma.validator<Prisma.ChatUserInclude>()({
    _count: { select: { conversations: true } },
});

const userDashboardInclude = Prisma.validator<Prisma.ChatUserInclude>()({
    _count: { select: { conversations: true } },
    conversations: {
        orderBy: { createdAt: "desc" },
        take: 1,
    },
});

export type ChatUserDetail = Prisma.ChatUserGetPayload<{
    include: typeof userDetailInclude;
}>;

export type ChatUserListRow = Prisma.ChatUserGetPayload<{
    include: typeof userCountInclude;
}>;

export type ChatUserDashboardRow = Prisma.ChatUserGetPayload<{
    include: typeof userDashboardInclude;
}>;

function buildUserWhere(workspaceId: string, filters: DashboardUserFilters): Prisma.ChatUserWhereInput {
    const where: Prisma.ChatUserWhereInput = { workspaceId };

    if (filters.query) {
        where.OR = [
            { name: { contains: filters.query, mode: "insensitive" } },
            { phoneNumber: { contains: filters.query, mode: "insensitive" } },
        ];
    }

    if (filters.label) {
        where.label = filters.label;
    }

    const conversationWhere: Prisma.MessageWhereInput = {};
    if (filters.dateFrom || filters.dateTo) {
        const createdAt: Prisma.DateTimeFilter = {};
        if (filters.dateFrom) {
            createdAt.gte = filters.dateFrom;
        }
        if (filters.dateTo) {
            createdAt.lte = filters.dateTo;
        }

        conversationWhere.createdAt = createdAt;
    }

    if (filters.channelId?.trim()) {
        conversationWhere.metadata = {
            path: ["channelId"],
            equals: filters.channelId.trim(),
        };
    }

    if (Object.keys(conversationWhere).length > 0) {
        where.conversations = {
            some: conversationWhere,
        };
    }

    return where;
}

export const userRepo = {
    async getTotalUsers(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.chatUser.count({
            where: { workspaceId: resolvedWorkspaceId },
        });
    },

    async upsertUser(phoneNumber: string, workspaceId: string, name?: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.chatUser.upsert({
            where: {
                workspaceId_phoneNumber: {
                    workspaceId: resolvedWorkspaceId,
                    phoneNumber,
                },
            },
            update: { name: name ?? undefined },
            create: { workspaceId: resolvedWorkspaceId, phoneNumber, name },
        });
    },

    async mergeSegments(userId: string, workspaceId: string, segments: string[]) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const normalizedSegments = Array.from(new Set(segments.map((item) => item.trim()).filter(Boolean)));
        if (normalizedSegments.length === 0) {
            return this.getUserById(userId, resolvedWorkspaceId);
        }

        const existing = await prisma.chatUser.findFirst({
            where: {
                id: userId,
                workspaceId: resolvedWorkspaceId,
            },
            select: {
                id: true,
                segments: true,
            },
        });

        if (!existing) {
            throw new Error("User not found in workspace");
        }

        const merged = Array.from(new Set([...(existing.segments || []), ...normalizedSegments]));
        return prisma.chatUser.update({
            where: { id: existing.id },
            data: {
                segments: merged,
            },
        });
    },

    async getUserByPhone(phoneNumber: string, workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.chatUser.findFirst({
            where: {
                workspaceId: resolvedWorkspaceId,
                phoneNumber,
            },
        });
    },

    async getUserById(id: string, workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.chatUser.findFirst({
            where: {
                id,
                workspaceId: resolvedWorkspaceId,
            },
            include: userDetailInclude,
        });
    },

    async blockUser(id: string, isBlocked: boolean, workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const user = await prisma.chatUser.findFirst({
            where: {
                id,
                workspaceId: resolvedWorkspaceId,
            },
            select: { id: true },
        });

        if (!user) {
            throw new Error("User not found in workspace");
        }

        return prisma.chatUser.update({
            where: { id: user.id },
            data: { isBlocked },
        });
    },

    async updateLabel(id: string, label: string | null, workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const user = await prisma.chatUser.findFirst({
            where: {
                id,
                workspaceId: resolvedWorkspaceId,
            },
            select: { id: true },
        });

        if (!user) {
            throw new Error("User not found in workspace");
        }

        return prisma.chatUser.update({
            where: { id: user.id },
            data: { label },
        });
    },

    async getAllUsers(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.chatUser.findMany({
            where: { workspaceId: resolvedWorkspaceId },
            orderBy: { updatedAt: "desc" },
            include: userCountInclude,
        });
    },

    async getDistinctLabels(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const labels = await prisma.chatUser.findMany({
            where: {
                workspaceId: resolvedWorkspaceId,
                label: { not: null },
            },
            distinct: ["label"],
            select: { label: true },
            orderBy: { label: "asc" },
        });
        return labels.map((item) => item.label).filter((value): value is string => Boolean(value));
    },

    async getUsersForDashboard(
        workspaceId: string,
        filters: DashboardUserFilters = {}
    ): Promise<ChatUserDashboardRow[]> {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.chatUser.findMany({
            where: buildUserWhere(resolvedWorkspaceId, filters),
            orderBy: { updatedAt: "desc" },
            include: userDashboardInclude,
        });
    },
};
