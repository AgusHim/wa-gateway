import { TenantRole } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { assertTenantScope } from "@/lib/tenant/context";

const DEFAULT_ALLOWED_ROLES: TenantRole[] = [TenantRole.OWNER, TenantRole.ADMIN, TenantRole.OPERATOR];

export type ToolPolicyDecision = {
    isEnabled: boolean;
    allowedRoles: TenantRole[];
    allowed: boolean;
};

function normalizeRoles(roles: TenantRole[] | undefined): TenantRole[] {
    if (!roles || roles.length === 0) {
        return [...DEFAULT_ALLOWED_ROLES];
    }

    return Array.from(new Set(roles));
}

export const workspaceToolPolicyRepo = {
    async listPolicies(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.workspaceToolPolicy.findMany({
            where: { workspaceId: resolvedWorkspaceId },
            orderBy: [{ toolName: "asc" }],
        });
    },

    async upsertPolicy(input: {
        workspaceId: string;
        toolName: string;
        isEnabled?: boolean;
        allowedRoles?: TenantRole[];
    }) {
        const resolvedWorkspaceId = assertTenantScope(input.workspaceId);
        const toolName = input.toolName.trim();
        if (!toolName) {
            throw new Error("toolName is required");
        }

        const allowedRoles = normalizeRoles(input.allowedRoles);

        return prisma.workspaceToolPolicy.upsert({
            where: {
                workspaceId_toolName: {
                    workspaceId: resolvedWorkspaceId,
                    toolName,
                },
            },
            update: {
                isEnabled: input.isEnabled ?? true,
                allowedRoles,
            },
            create: {
                workspaceId: resolvedWorkspaceId,
                toolName,
                isEnabled: input.isEnabled ?? true,
                allowedRoles,
            },
        });
    },

    async evaluatePolicy(workspaceId: string, toolName: string, actorRole: TenantRole): Promise<ToolPolicyDecision> {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const normalizedToolName = toolName.trim();

        const policy = await prisma.workspaceToolPolicy.findUnique({
            where: {
                workspaceId_toolName: {
                    workspaceId: resolvedWorkspaceId,
                    toolName: normalizedToolName,
                },
            },
        });

        const isEnabled = policy?.isEnabled ?? true;
        const allowedRoles = normalizeRoles(policy?.allowedRoles);
        const allowed = isEnabled && allowedRoles.includes(actorRole);

        return {
            isEnabled,
            allowedRoles,
            allowed,
        };
    },
};
