"use client";

import { useEffect, useMemo, useState } from "react";
import { parseWaStatusResponse, type WAConnectionStatus } from "@/types/dashboard";

export function WaStatusCard() {
    const [status, setStatus] = useState<WAConnectionStatus>("close");

    useEffect(() => {
        let active = true;

        const load = async () => {
            try {
                const res = await fetch("/api/wa/status", { cache: "no-store" });
                const data = parseWaStatusResponse(await res.json());
                if (active && data) {
                    setStatus(data.status);
                }
            } catch {
                if (active) setStatus("close");
            }
        };

        load();
        const interval = setInterval(load, 10000);

        return () => {
            active = false;
            clearInterval(interval);
        };
    }, []);

    const text = useMemo(() => {
        if (status === "open") return "Connected";
        if (status === "connecting") return "Connecting";
        return "Disconnected";
    }, [status]);

    const className = status === "open"
        ? "text-emerald-600"
        : status === "connecting"
            ? "text-amber-600"
            : "text-rose-600";

    return (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">Status Koneksi WA</p>
            <p className={`mt-2 text-2xl font-semibold ${className}`}>{text}</p>
        </div>
    );
}
