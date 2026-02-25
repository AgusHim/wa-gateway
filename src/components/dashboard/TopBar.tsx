"use client";

import { signOut } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";

type WAStatus = "open" | "close" | "connecting";

function statusLabel(status: WAStatus): string {
    if (status === "open") return "Connected";
    if (status === "connecting") return "Connecting";
    return "Disconnected";
}

function statusClass(status: WAStatus): string {
    if (status === "open") return "bg-emerald-100 text-emerald-700";
    if (status === "connecting") return "bg-amber-100 text-amber-700";
    return "bg-rose-100 text-rose-700";
}

export function TopBar() {
    const [status, setStatus] = useState<WAStatus>("close");

    useEffect(() => {
        let mounted = true;

        const loadStatus = async () => {
            try {
                const res = await fetch("/api/wa/status", { cache: "no-store" });
                const data = (await res.json()) as { status?: WAStatus };
                if (mounted && data.status) {
                    setStatus(data.status);
                }
            } catch {
                if (mounted) setStatus("close");
            }
        };

        loadStatus();
        const interval = setInterval(loadStatus, 10000);

        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, []);

    const label = useMemo(() => statusLabel(status), [status]);

    return (
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
            <div>
                <p className="text-sm text-slate-500">Dashboard</p>
                <h2 className="text-base font-semibold text-slate-900">WhatsApp AI Gateway</h2>
            </div>

            <div className="flex items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusClass(status)}`}>
                    WA: {label}
                </span>
                <button
                    type="button"
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                    Logout
                </button>
            </div>
        </header>
    );
}
