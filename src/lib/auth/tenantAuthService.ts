import { InviteStatus, TenantRole } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { authUserRepo } from "@/lib/db/authUserRepo";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import { generateRawToken, hashToken } from "@/lib/security/token";
import { getDefaultTenantContext } from "@/lib/tenant/context";

function slugify(input: string): string {
    return input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "workspace";
}

async function ensureUniqueOrganizationSlug(baseSlug: string): Promise<string> {
    let candidate = baseSlug;
    let counter = 1;

    while (true) {
        const existing = await prisma.organization.findUnique({ where: { slug: candidate }, select: { id: true } });
        if (!existing) return candidate;
        counter += 1;
        candidate = `${baseSlug}-${counter}`;
    }
}

async function ensureUniqueWorkspaceSlug(organizationId: string, baseSlug: string): Promise<string> {
    let candidate = baseSlug;
    let counter = 1;

    while (true) {
        const existing = await prisma.workspace.findFirst({
            where: { organizationId, slug: candidate },
            select: { id: true },
        });
        if (!existing) return candidate;
        counter += 1;
        candidate = `${baseSlug}-${counter}`;
    }
}

function getUserPrimaryTenantContext(user: Awaited<ReturnType<typeof authUserRepo.findByEmail>>) {
    if (!user) return null;

    const organizationId = user.defaultOrganizationId
        || user.memberships[0]?.organizationId
        || user.workspaceMemberships[0]?.workspace.organizationId;
    const membership = organizationId
        ? user.memberships.find((item) => item.organizationId === organizationId) ?? user.memberships[0]
        : user.memberships[0];
    const workspaceMembership = user.defaultWorkspaceId
        ? user.workspaceMemberships.find((item) => item.workspaceId === user.defaultWorkspaceId)
            ?? user.workspaceMemberships[0]
        : user.workspaceMemberships.find((item) => item.workspace.organizationId === organizationId)
            ?? user.workspaceMemberships[0];
    const workspaceId = user.defaultWorkspaceId
        || workspaceMembership?.workspaceId
        || membership?.organization.workspaces[0]?.id
        || null;
    const membershipRole = membership?.role || workspaceMembership?.role || null;

    if (!membershipRole || !organizationId || !workspaceId) {
        return null;
    }

    return {
        organizationId,
        workspaceId,
        membershipRole,
    };
}

export async function authenticateTenantUser(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await authUserRepo.findByEmail(normalizedEmail);
    if (!user || !user.isActive) {
        return null;
    }

    const passwordMatch = await verifyPassword(password, user.passwordHash);
    if (!passwordMatch) {
        return null;
    }

    const context = getUserPrimaryTenantContext(user);
    if (!context) {
        return null;
    }

    return {
        user,
        context,
    };
}

export async function bootstrapLegacyAdminIfNeeded(email: string, password: string) {
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword || email.trim().toLowerCase() !== adminEmail || password !== adminPassword) {
        return null;
    }

    const existing = await authUserRepo.findByEmail(adminEmail);
    if (existing) {
        return null;
    }

    const tenant = getDefaultTenantContext();
    const passwordHash = await hashPassword(adminPassword);

    const user = await prisma.$transaction(async (tx) => {
        await tx.organization.upsert({
            where: { id: tenant.organizationId },
            update: {},
            create: {
                id: tenant.organizationId,
                name: "Default Organization",
                slug: tenant.organizationId,
                isActive: true,
            },
        });

        await tx.workspace.upsert({
            where: { id: tenant.workspaceId },
            update: { organizationId: tenant.organizationId },
            create: {
                id: tenant.workspaceId,
                organizationId: tenant.organizationId,
                name: "Default Workspace",
                slug: tenant.workspaceId,
                isActive: true,
            },
        });

        const user = await tx.user.create({
            data: {
                email: adminEmail,
                passwordHash,
                name: "Default Owner",
                role: TenantRole.OWNER,
                isActive: true,
                emailVerifiedAt: new Date(),
                defaultOrganizationId: tenant.organizationId,
                defaultWorkspaceId: tenant.workspaceId,
            },
        });

        await tx.membership.create({
            data: {
                organizationId: tenant.organizationId,
                userId: user.id,
                role: TenantRole.OWNER,
            },
        });

        await tx.workspaceMembership.create({
            data: {
                workspaceId: tenant.workspaceId,
                userId: user.id,
                role: TenantRole.OWNER,
            },
        });

        return user;
    });

    const { billingService } = await import("@/lib/billing/service");
    await billingService.ensureOrganizationSubscription(tenant.organizationId);

    return user;
}

export async function registerOwnerWithOrganization(input: {
    name: string;
    email: string;
    password: string;
    organizationName: string;
    workspaceName: string;
}) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const existingUser = await authUserRepo.findByEmail(normalizedEmail);
    if (existingUser) {
        throw new Error("Email is already registered");
    }

    const passwordHash = await hashPassword(input.password);
    const baseOrgSlug = slugify(input.organizationName);

    const result = await prisma.$transaction(async (tx) => {
        const orgSlug = await ensureUniqueOrganizationSlug(baseOrgSlug);
        const organization = await tx.organization.create({
            data: {
                name: input.organizationName.trim(),
                slug: orgSlug,
                isActive: true,
            },
        });

        const baseWorkspaceSlug = slugify(input.workspaceName);
        const workspaceSlug = await ensureUniqueWorkspaceSlug(organization.id, baseWorkspaceSlug);
        const workspace = await tx.workspace.create({
            data: {
                organizationId: organization.id,
                name: input.workspaceName.trim(),
                slug: workspaceSlug,
                isActive: true,
            },
        });

        await tx.workspaceConfig.create({
            data: {
                workspaceId: workspace.id,
                isActive: true,
                model: "gemini-2.5-flash-lite",
                maxTokens: 1024,
            },
        });

        const user = await tx.user.create({
            data: {
                email: normalizedEmail,
                passwordHash,
                name: input.name.trim(),
                role: TenantRole.OWNER,
                isActive: true,
                defaultOrganizationId: organization.id,
                defaultWorkspaceId: workspace.id,
            },
        });

        await tx.membership.create({
            data: {
                organizationId: organization.id,
                userId: user.id,
                role: TenantRole.OWNER,
            },
        });

        await tx.workspaceMembership.create({
            data: {
                workspaceId: workspace.id,
                userId: user.id,
                role: TenantRole.OWNER,
            },
        });

        return {
            user,
            organization,
            workspace,
        };
    });

    const { billingService } = await import("@/lib/billing/service");
    await billingService.ensureOrganizationSubscription(result.organization.id);

    return result;
}

export async function createOrganizationInvite(input: {
    inviterUserId: string;
    organizationId: string;
    email: string;
    role: TenantRole;
    expiresInHours?: number;
}) {
    if (input.role === TenantRole.OWNER) {
        throw new Error("Owner invite is not supported");
    }

    const membership = await prisma.membership.findUnique({
        where: {
            organizationId_userId: {
                organizationId: input.organizationId,
                userId: input.inviterUserId,
            },
        },
    });

    if (!membership || (membership.role !== TenantRole.OWNER && membership.role !== TenantRole.ADMIN)) {
        throw new Error("Forbidden: only owner/admin can invite members");
    }

    const rawToken = generateRawToken();
    const expiresAt = new Date(Date.now() + (input.expiresInHours ?? 72) * 60 * 60 * 1000);
    const invite = await prisma.organizationInvite.create({
        data: {
            organizationId: input.organizationId,
            invitedByUserId: input.inviterUserId,
            email: input.email.trim().toLowerCase(),
            role: input.role,
            tokenHash: hashToken(rawToken),
            status: InviteStatus.PENDING,
            expiresAt,
        },
    });

    return {
        invite,
        rawToken,
    };
}

export async function acceptOrganizationInvite(input: {
    token: string;
    name: string;
    password: string;
}) {
    const tokenHash = hashToken(input.token);
    const invite = await prisma.organizationInvite.findUnique({
        where: { tokenHash },
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
    });

    if (!invite || invite.status !== InviteStatus.PENDING || invite.expiresAt.getTime() <= Date.now()) {
        throw new Error("Invite is invalid or expired");
    }

    const workspace = invite.organization.workspaces[0];
    if (!workspace) {
        throw new Error("Organization has no active workspace");
    }

    const existingMembership = await prisma.membership.findFirst({
        where: {
            organizationId: invite.organizationId,
            user: {
                email: invite.email,
            },
        },
        select: { id: true },
    });

    if (!existingMembership) {
        const { billingService } = await import("@/lib/billing/service");
        const billingSnapshot = await billingService.getBillingSnapshot(workspace.id);
        if (billingSnapshot.usage.seats.used >= billingSnapshot.usage.seats.limit) {
            throw new Error("Seat limit reached for current plan");
        }
    }

    const passwordHash = await hashPassword(input.password);

    return prisma.$transaction(async (tx) => {
        let user = await tx.user.findUnique({ where: { email: invite.email } });

        if (!user) {
            user = await tx.user.create({
                data: {
                    email: invite.email,
                    passwordHash,
                    name: input.name.trim(),
                    role: invite.role,
                    isActive: true,
                    emailVerifiedAt: new Date(),
                    defaultOrganizationId: invite.organizationId,
                    defaultWorkspaceId: workspace.id,
                },
            });
        } else {
            user = await tx.user.update({
                where: { id: user.id },
                data: {
                    passwordHash,
                    name: input.name.trim() || user.name,
                    role: user.role === TenantRole.OWNER ? user.role : invite.role,
                    emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
                    defaultOrganizationId: user.defaultOrganizationId ?? invite.organizationId,
                    defaultWorkspaceId: user.defaultWorkspaceId ?? workspace.id,
                },
            });
        }

        await tx.membership.upsert({
            where: {
                organizationId_userId: {
                    organizationId: invite.organizationId,
                    userId: user.id,
                },
            },
            update: {
                role: invite.role,
            },
            create: {
                organizationId: invite.organizationId,
                userId: user.id,
                role: invite.role,
            },
        });

        await tx.workspaceMembership.upsert({
            where: {
                workspaceId_userId: {
                    workspaceId: workspace.id,
                    userId: user.id,
                },
            },
            update: {
                role: invite.role,
            },
            create: {
                workspaceId: workspace.id,
                userId: user.id,
                role: invite.role,
            },
        });

        await tx.organizationInvite.update({
            where: { id: invite.id },
            data: {
                status: InviteStatus.ACCEPTED,
                acceptedAt: new Date(),
            },
        });

        return {
            user,
            organizationId: invite.organizationId,
            workspaceId: workspace.id,
            membershipRole: invite.role,
        };
    });
}

export async function createPasswordResetToken(email: string) {
    const user = await authUserRepo.findByEmail(email.trim().toLowerCase());
    if (!user) {
        return null;
    }

    const rawToken = generateRawToken();
    const token = await prisma.passwordResetToken.create({
        data: {
            userId: user.id,
            tokenHash: hashToken(rawToken),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
    });

    return { user, token, rawToken };
}

export async function resetPasswordWithToken(rawToken: string, newPassword: string) {
    const tokenHash = hashToken(rawToken);
    const token = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!token || token.consumedAt || token.expiresAt.getTime() <= Date.now()) {
        throw new Error("Reset token invalid or expired");
    }

    const passwordHash = await hashPassword(newPassword);

    await prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id: token.userId },
            data: {
                passwordHash,
                sessionVersion: { increment: 1 },
            },
        });

        await tx.passwordResetToken.update({
            where: { id: token.id },
            data: { consumedAt: new Date() },
        });

        await tx.authSession.updateMany({
            where: { userId: token.userId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    });
}

export async function createEmailVerificationToken(userId: string, email: string) {
    const rawToken = generateRawToken();
    const token = await prisma.emailVerificationToken.create({
        data: {
            userId,
            email: email.trim().toLowerCase(),
            tokenHash: hashToken(rawToken),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
    });

    return { token, rawToken };
}

export async function verifyEmailWithToken(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    const token = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });

    if (!token || token.consumedAt || token.expiresAt.getTime() <= Date.now()) {
        throw new Error("Verification token invalid or expired");
    }

    await prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id: token.userId },
            data: { emailVerifiedAt: new Date() },
        });

        await tx.emailVerificationToken.update({
            where: { id: token.id },
            data: { consumedAt: new Date() },
        });
    });
}

export type AuthenticatedTenantContext = {
    organizationId: string;
    workspaceId: string;
    membershipRole: TenantRole;
};

export function resolveUserContextOrThrow(
    user: Awaited<ReturnType<typeof authUserRepo.findByEmail>>
): AuthenticatedTenantContext {
    const context = getUserPrimaryTenantContext(user);
    if (!context) {
        throw new Error("User is not assigned to any organization/workspace");
    }
    return context;
}

export async function listOrganizationMembers(organizationId: string) {
    return prisma.membership.findMany({
        where: { organizationId },
        orderBy: { createdAt: "asc" },
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    isActive: true,
                    role: true,
                    lastLoginAt: true,
                    createdAt: true,
                },
            },
        },
    });
}

export async function listOrganizationPendingInvites(organizationId: string) {
    return prisma.organizationInvite.findMany({
        where: {
            organizationId,
            status: InviteStatus.PENDING,
            expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
        include: {
            invitedBy: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                },
            },
        },
    });
}
