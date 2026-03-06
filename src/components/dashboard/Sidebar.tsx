"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Role = "OWNER" | "ADMIN" | "OPERATOR" | "VIEWER";

type SidebarPermission = "read" | "write" | "manage_billing" | "manage_channel";

type NavItem = {
    href: string;
    label: string;
    permission: SidebarPermission;
    tenantRoles?: Role[];
    platformRoles?: Role[];
};

const ROLE_PERMISSION_MATRIX: Record<Role, Record<SidebarPermission, boolean>> = {
    OWNER: {
        read: true,
        write: true,
        manage_billing: true,
        manage_channel: true,
    },
    ADMIN: {
        read: true,
        write: true,
        manage_billing: true,
        manage_channel: true,
    },
    OPERATOR: {
        read: true,
        write: true,
        manage_billing: false,
        manage_channel: false,
    },
    VIEWER: {
        read: true,
        write: false,
        manage_billing: false,
        manage_channel: false,
    },
};

const TENANT_NAV_ITEMS = [
    { href: "/", label: "Overview", permission: "read" },
    { href: "/conversations", label: "Conversations", permission: "read" },
    { href: "/users", label: "Users", permission: "read" },
    { href: "/monitor", label: "Live Monitor", permission: "read" },
    { href: "/campaigns", label: "Campaigns", permission: "read" },
    { href: "/knowledge", label: "Knowledge Base", permission: "read" },
    { href: "/analytics", label: "Analytics", permission: "read" },
    { href: "/tool-logs", label: "Tool Logs", permission: "read" },
    { href: "/usage", label: "Usage", permission: "read" },
    { href: "/onboarding", label: "Onboarding", permission: "read" },
    { href: "/channels", label: "Channels", permission: "manage_channel" },
    { href: "/integrations", label: "Integrations", permission: "manage_channel" },
    { href: "/config", label: "Config", permission: "manage_channel" },
    { href: "/team", label: "Team & Access", permission: "read", tenantRoles: ["OWNER", "ADMIN"] },
    { href: "/organization", label: "Organization", permission: "read", tenantRoles: ["OWNER", "ADMIN"] },
    { href: "/billing", label: "Billing", permission: "manage_billing" },
] satisfies NavItem[];

const ROOT_ADMIN_NAV_ITEMS = [
    { href: "/super-admin", label: "Super Admin", permission: "manage_billing", platformRoles: ["OWNER"] },
] satisfies NavItem[];

type SidebarProps = {
    membershipRole: Role;
    platformRole: Role;
};

function isAllowed(membershipRole: Role, platformRole: Role, item: NavItem): boolean {
    const canByPermission = ROLE_PERMISSION_MATRIX[membershipRole][item.permission];
    if (!canByPermission) {
        return false;
    }

    if (item.tenantRoles && !item.tenantRoles.includes(membershipRole)) {
        return false;
    }

    if (item.platformRoles && !item.platformRoles.includes(platformRole)) {
        return false;
    }

    return true;
}

function isActivePath(pathname: string, href: string): boolean {
    if (href === "/") {
        return pathname === "/";
    }
    return pathname === href || pathname.startsWith(`${href}/`);
}

function renderMenu(pathname: string, items: NavItem[]) {
    return items.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
            <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-2 text-sm transition ${
                    active
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:bg-slate-100"
                }`}
            >
                {item.label}
            </Link>
        );
    });
}

export function Sidebar({ membershipRole, platformRole }: SidebarProps) {
    const pathname = usePathname();
    const tenantVisibleItems = TENANT_NAV_ITEMS.filter((item) => isAllowed(membershipRole, platformRole, item));
    const rootAdminVisibleItems = ROOT_ADMIN_NAV_ITEMS.filter((item) => isAllowed(membershipRole, platformRole, item));

    return (
        <aside className="w-full border-b border-slate-200 bg-white p-4 lg:h-screen lg:w-64 lg:border-b-0 lg:border-r">
            <div className="mb-5">
                <h1 className="text-lg font-semibold text-slate-900">WA Gateway Admin</h1>
                <p className="text-xs text-slate-500">SmartScholar</p>
            </div>

            <div className="space-y-4">
                <section>
                    <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tenant Menu</p>
                    <nav className="grid gap-1">
                        {renderMenu(pathname, tenantVisibleItems)}
                    </nav>
                </section>

                {rootAdminVisibleItems.length > 0 ? (
                    <section>
                        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Root Admin</p>
                        <nav className="grid gap-1">
                            {renderMenu(pathname, rootAdminVisibleItems)}
                        </nav>
                    </section>
                ) : null}
            </div>
        </aside>
    );
}
