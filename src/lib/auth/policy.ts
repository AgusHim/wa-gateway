import { TenantRole } from "@prisma/client";

export type TenantPermission =
    | "read"
    | "write"
    | "manage_billing"
    | "manage_channel";

type PermissionMatrix = Record<TenantRole, Record<TenantPermission, boolean>>;

const ROLE_PERMISSION_MATRIX: PermissionMatrix = {
    [TenantRole.OWNER]: {
        read: true,
        write: true,
        manage_billing: true,
        manage_channel: true,
    },
    [TenantRole.ADMIN]: {
        read: true,
        write: true,
        manage_billing: true,
        manage_channel: true,
    },
    [TenantRole.OPERATOR]: {
        read: true,
        write: true,
        manage_billing: false,
        manage_channel: false,
    },
    [TenantRole.VIEWER]: {
        read: true,
        write: false,
        manage_billing: false,
        manage_channel: false,
    },
};

export const ROUTE_PERMISSION_MATRIX: Array<{ prefix: string; permission: TenantPermission }> = [
    { prefix: "/config", permission: "manage_channel" },
    { prefix: "/qr", permission: "manage_channel" },
    { prefix: "/channels", permission: "manage_channel" },
    { prefix: "/integrations", permission: "manage_channel" },
    { prefix: "/super-admin", permission: "manage_billing" },
    { prefix: "/billing", permission: "manage_billing" },
    { prefix: "/organization", permission: "read" },
    { prefix: "/usage", permission: "read" },
    { prefix: "/users", permission: "read" },
    { prefix: "/campaigns", permission: "read" },
    { prefix: "/knowledge", permission: "read" },
    { prefix: "/conversations", permission: "read" },
    { prefix: "/monitor", permission: "read" },
    { prefix: "/tool-logs", permission: "read" },
    { prefix: "/analytics", permission: "read" },
    { prefix: "/onboarding", permission: "read" },
    { prefix: "/team", permission: "read" },
    { prefix: "/", permission: "read" },
];

function isTenantRole(value: unknown): value is TenantRole {
    return value === TenantRole.OWNER
        || value === TenantRole.ADMIN
        || value === TenantRole.OPERATOR
        || value === TenantRole.VIEWER;
}

export function toTenantRole(value: unknown): TenantRole | null {
    return isTenantRole(value) ? value : null;
}

export function hasTenantPermission(role: TenantRole, permission: TenantPermission): boolean {
    return ROLE_PERMISSION_MATRIX[role][permission];
}

export function resolveRoutePermission(pathname: string): TenantPermission {
    for (const item of ROUTE_PERMISSION_MATRIX) {
        if (item.prefix === "/") {
            continue;
        }
        if (pathname.startsWith(item.prefix)) {
            return item.permission;
        }
    }

    return "read";
}
