export type TenantContext = {
    organizationId: string;
    workspaceId: string;
    channelId: string;
};

const DEFAULT_ORGANIZATION_ID = process.env.DEFAULT_ORGANIZATION_ID || "default-org";
const DEFAULT_WORKSPACE_ID = process.env.DEFAULT_WORKSPACE_ID || "default-workspace";
const DEFAULT_CHANNEL_ID = process.env.DEFAULT_CHANNEL_ID || "default-channel";

export function getDefaultTenantContext(): TenantContext {
    return {
        organizationId: DEFAULT_ORGANIZATION_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        channelId: DEFAULT_CHANNEL_ID,
    };
}

export function assertTenantScope(workspaceId?: string): string {
    const value = (workspaceId || "").trim();
    if (!value) {
        throw new Error("workspaceId is required");
    }
    return value;
}

export const requireWorkspaceId = assertTenantScope;
