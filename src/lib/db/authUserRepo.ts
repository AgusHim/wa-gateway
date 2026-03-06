import { prisma } from "./client";
import { TenantRole } from "@prisma/client";

export const authUserRepo = {
    async findByEmail(email: string) {
        return prisma.user.findUnique({
            where: { email: email.trim().toLowerCase() },
            include: {
                memberships: {
                    include: {
                        organization: {
                            include: {
                                workspaces: {
                                    where: { isActive: true },
                                    orderBy: { createdAt: "asc" },
                                    take: 1,
                                },
                            },
                        },
                    },
                    orderBy: { createdAt: "asc" },
                },
                workspaceMemberships: {
                    where: {
                        workspace: { isActive: true },
                    },
                    orderBy: { createdAt: "asc" },
                    include: {
                        workspace: {
                            select: {
                                id: true,
                                organizationId: true,
                                isActive: true,
                                name: true,
                            },
                        },
                    },
                },
            },
        });
    },

    async findById(userId: string) {
        return prisma.user.findUnique({
            where: { id: userId },
            include: {
                memberships: {
                    orderBy: { createdAt: "asc" },
                    include: {
                        organization: {
                            include: {
                                workspaces: {
                                    where: { isActive: true },
                                    orderBy: { createdAt: "asc" },
                                    take: 1,
                                },
                            },
                        },
                    },
                },
                workspaceMemberships: {
                    where: {
                        workspace: { isActive: true },
                    },
                    orderBy: { createdAt: "asc" },
                    include: {
                        workspace: {
                            select: {
                                id: true,
                                organizationId: true,
                                isActive: true,
                                name: true,
                            },
                        },
                    },
                },
            },
        });
    },

    async createUser(data: {
        email: string;
        passwordHash: string;
        name?: string;
        role?: TenantRole;
        isActive?: boolean;
        emailVerifiedAt?: Date;
    }) {
        return prisma.user.create({
            data: {
                email: data.email.trim().toLowerCase(),
                passwordHash: data.passwordHash,
                name: data.name,
                role: data.role ?? TenantRole.VIEWER,
                isActive: data.isActive ?? true,
                emailVerifiedAt: data.emailVerifiedAt,
            },
        });
    },

    async touchLastLogin(userId: string) {
        return prisma.user.update({
            where: { id: userId },
            data: { lastLoginAt: new Date() },
            select: { id: true },
        });
    },

    async markEmailVerified(userId: string) {
        return prisma.user.update({
            where: { id: userId },
            data: { emailVerifiedAt: new Date() },
        });
    },

    async updatePassword(userId: string, passwordHash: string) {
        return prisma.user.update({
            where: { id: userId },
            data: {
                passwordHash,
                sessionVersion: { increment: 1 },
            },
        });
    },

    async incrementSessionVersion(userId: string) {
        return prisma.user.update({
            where: { id: userId },
            data: { sessionVersion: { increment: 1 } },
            select: { id: true, sessionVersion: true },
        });
    },

    async ensureMembership(input: {
        userId: string;
        organizationId: string;
        role: TenantRole;
    }) {
        return prisma.membership.upsert({
            where: {
                organizationId_userId: {
                    organizationId: input.organizationId,
                    userId: input.userId,
                },
            },
            update: { role: input.role },
            create: {
                organizationId: input.organizationId,
                userId: input.userId,
                role: input.role,
            },
        });
    },

    async ensureWorkspaceMembership(input: {
        userId: string;
        workspaceId: string;
        role: TenantRole;
    }) {
        return prisma.workspaceMembership.upsert({
            where: {
                workspaceId_userId: {
                    workspaceId: input.workspaceId,
                    userId: input.userId,
                },
            },
            update: { role: input.role },
            create: {
                workspaceId: input.workspaceId,
                userId: input.userId,
                role: input.role,
            },
        });
    },

    async setDefaultTenantContext(userId: string, organizationId: string, workspaceId: string) {
        return prisma.user.update({
            where: { id: userId },
            data: {
                defaultOrganizationId: organizationId,
                defaultWorkspaceId: workspaceId,
            },
        });
    },
};
