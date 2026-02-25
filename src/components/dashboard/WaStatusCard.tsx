"use client";

import { useEffect, useMemo, useState } from "react";

type WAStatus = "open" | "close" | "connecting";

export function WaStatusCard() {
    const [status, setStatus] = useState<WAStatus>("close");

    useEffect(() => {
        let active = true;

        const load = async () => {
            try {
                const res = await fetch("/api/wa/status", { cache: "no-store" });
                const data = (await res.json()) as { status?: WAStatus };
                if (active && data.status) {
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
