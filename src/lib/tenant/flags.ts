import { prisma } from "../db/client";
import { RuntimeCache } from "../cache/runtimeCache";
import { assertTenantScope } from "./context";

export type TenantRuntimeFlags = {
    organizationId: string;
    workspaceId: string;
    organizationActive: boolean;
    workspaceActive: boolean;
    botActive: boolean;
    allowAgent: boolean;
    allowOutbound: boolean;
};

const flagsCache = new RuntimeCache<TenantRuntimeFlags>(30_000);

function cacheKey(workspaceId: string): string {
    return `tenant-flags:${workspaceId}`;
}

export async function getWorkspaceRuntimeFlags(workspaceId: string): Promise<TenantRuntimeFlags> {
    const resolvedWorkspaceId = assertTenantScope(workspaceId);

    return flagsCache.getOrLoad(cacheKey(resolvedWorkspaceId), async () => {
        const workspace = await prisma.workspace.findUnique({
            where: { id: resolvedWorkspaceId },
            include: {
                organization: {
                    select: {
                        id: true,
                        isActive: true,
                    },
                },
                config: {
                    select: {
                        isActive: true,
                    },
                },
            },
        });

        if (!workspace) {
            return {
                organizationId: "",
                workspaceId: resolvedWorkspaceId,
                organizationActive: false,
                workspaceActive: false,
                botActive: false,
                allowAgent: false,
                allowOutbound: false,
            };
        }

        const organizationActive = workspace.organization?.isActive ?? false;
        const workspaceActive = workspace.isActive;
        const botActive = workspace.config?.isActive ?? true;

        return {
            organizationId: workspace.organizationId,
            workspaceId: resolvedWorkspaceId,
            organizationActive,
            workspaceActive,
            botActive,
            allowAgent: organizationActive && workspaceActive && botActive,
            allowOutbound: organizationActive && workspaceActive,
        };
    });
}

export function invalidateWorkspaceRuntimeFlags(workspaceId: string): void {
    const resolvedWorkspaceId = assertTenantScope(workspaceId);
    flagsCache.invalidate(cacheKey(resolvedWorkspaceId));
}
