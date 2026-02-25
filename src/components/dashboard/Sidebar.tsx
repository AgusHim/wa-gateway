"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
    { href: "/", label: "Overview" },
    { href: "/monitor", label: "Live Monitor" },
    { href: "/conversations", label: "Conversations" },
    { href: "/users", label: "Users" },
    { href: "/config", label: "Config" },
    { href: "/tool-logs", label: "Tool Logs" },
    { href: "/analytics", label: "Analytics" },
    { href: "/qr", label: "QR Scanner" },
];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className="w-full border-b border-slate-200 bg-white p-4 lg:h-screen lg:w-64 lg:border-b-0 lg:border-r">
            <div className="mb-5">
                <h1 className="text-lg font-semibold text-slate-900">WA Gateway Admin</h1>
                <p className="text-xs text-slate-500">SmartScholar</p>
            </div>

            <nav className="grid gap-1">
                {navItems.map((item) => {
                    const active = pathname === item.href;
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
                })}
            </nav>
        </aside>
    );
}
