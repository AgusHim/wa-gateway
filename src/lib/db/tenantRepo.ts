import { prisma } from "./client";
import { TenantRole } from "@prisma/client";
import { getDefaultTenantContext } from "@/lib/tenant/context";
import { normalizeChannelProvider } from "@/lib/channel/provider";

export const tenantRepo = {
    async ensureDefaultTenant() {
        const { organizationId, workspaceId, channelId } = getDefaultTenantContext();

        await prisma.organization.upsert({
            where: { id: organizationId },
            update: {},
            create: {
                id: organizationId,
                name: "Default Organization",
                slug: organizationId,
            },
        });

        await prisma.workspace.upsert({
            where: { id: workspaceId },
            update: {
                organizationId,
            },
            create: {
                id: workspaceId,
                organizationId,
                name: "Default Workspace",
                slug: workspaceId,
                isActive: true,
            },
        });

        await prisma.channel.upsert({
            where: { id: channelId },
            update: {
                workspaceId,
            },
            create: {
                id: channelId,
                workspaceId,
                name: "Default WA Channel",
                provider: normalizeChannelProvider("whatsapp"),
                status: "active",
            },
        });

        await prisma.workspaceConfig.upsert({
            where: { workspaceId },
            update: {},
            create: {
                workspaceId,
                isActive: true,
                model: "gemini-2.5-flash-lite",
                maxTokens: 1024,
            },
        });

        const { billingService } = await import("@/lib/billing/service");
        await billingService.ensureOrganizationSubscription(organizationId);
    },

    async createSandboxWorkspace(input: {
        organizationId: string;
        userId: string;
    }) {
        const suffix = Date.now().toString().slice(-8);
        const slug = `sandbox-${suffix}`;
        const workspace = await prisma.workspace.create({
            data: {
                organizationId: input.organizationId,
                name: `Sandbox ${suffix}`,
                slug,
                isActive: true,
                memberships: {
                    create: {
                        userId: input.userId,
                        role: TenantRole.OWNER,
                    },
                },
                channels: {
                    create: {
                        name: `Sandbox WA ${suffix}`,
                        provider: normalizeChannelProvider("whatsapp"),
                        status: "active",
                        isEnabled: true,
                        isPrimary: true,
                    },
                },
                config: {
                    create: {
                        isActive: true,
                        model: "gemini-2.5-flash-lite",
                        maxTokens: 1024,
                    },
                },
            },
        });

        return workspace;
    },
};
