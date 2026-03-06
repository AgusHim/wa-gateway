"use client";

import { signOut } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { parseWaStatusResponse, type WAConnectionStatus } from "@/types/dashboard";

type WorkspaceOption = {
    workspaceId: string;
    workspaceName: string;
    organizationId: string;
    role: string;
    isCurrent: boolean;
};

function statusLabel(status: WAConnectionStatus): string {
    if (status === "open") return "Connected";
    if (status === "connecting") return "Connecting";
    return "Disconnected";
}

function statusClass(status: WAConnectionStatus): string {
    if (status === "open") return "bg-emerald-100 text-emerald-700";
    if (status === "connecting") return "bg-amber-100 text-amber-700";
    return "bg-rose-100 text-rose-700";
}

export function TopBar() {
    const [status, setStatus] = useState<WAConnectionStatus>("close");
    const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
    const [switchingWorkspace, setSwitchingWorkspace] = useState(false);

    useEffect(() => {
        let mounted = true;

        const loadStatus = async () => {
            try {
                const res = await fetch("/api/wa/status", { cache: "no-store" });
                const data = parseWaStatusResponse(await res.json());
                if (mounted && data) {
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

    useEffect(() => {
        let mounted = true;

        const loadWorkspaces = async () => {
            try {
                const response = await fetch("/api/auth/workspaces", { cache: "no-store" });
                const payload = await response.json() as {
                    success?: boolean;
                    data?: {
                        currentWorkspaceId?: string;
                        workspaces?: WorkspaceOption[];
                    };
                };
                if (!mounted || payload.success !== true) {
                    return;
                }

                const options = Array.isArray(payload.data?.workspaces) ? payload.data?.workspaces : [];
                setWorkspaces(options);
                setSelectedWorkspaceId(payload.data?.currentWorkspaceId || options[0]?.workspaceId || "");
            } catch {
                if (mounted) {
                    setWorkspaces([]);
                }
            }
        };

        loadWorkspaces();
        return () => {
            mounted = false;
        };
    }, []);

    const label = useMemo(() => statusLabel(status), [status]);
    const hasWorkspaceOptions = workspaces.length > 1;

    const switchWorkspace = async () => {
        if (!selectedWorkspaceId) {
            return;
        }

        try {
            setSwitchingWorkspace(true);
            const response = await fetch("/api/auth/workspaces", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    workspaceId: selectedWorkspaceId,
                }),
            });
            if (!response.ok) {
                throw new Error("Gagal mengganti workspace");
            }
            window.location.reload();
        } catch {
            setSwitchingWorkspace(false);
        }
    };

    return (
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
            <div>
                <p className="text-sm text-slate-500">Dashboard</p>
                <h2 className="text-base font-semibold text-slate-900">WhatsApp AI Gateway</h2>
            </div>

            <div className="flex items-center gap-3">
                {hasWorkspaceOptions ? (
                    <div className="flex items-center gap-2">
                        <select
                            value={selectedWorkspaceId}
                            onChange={(event) => setSelectedWorkspaceId(event.target.value)}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                        >
                            {workspaces.map((workspace) => (
                                <option key={workspace.workspaceId} value={workspace.workspaceId}>
                                    {workspace.workspaceName}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={switchWorkspace}
                            disabled={switchingWorkspace}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                        >
                            {switchingWorkspace ? "Switching..." : "Switch"}
                        </button>
                    </div>
                ) : null}
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
