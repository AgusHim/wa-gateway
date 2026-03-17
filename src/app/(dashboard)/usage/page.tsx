"use client";

import { useEffect, useMemo, useState } from "react";

type UsageMetricRow = {
    used: number;
    limit: number;
    softLimitReached: boolean;
    hardLimitReached: boolean;
};

type UsagePayload = {
    success: boolean;
    data?: {
        month: string;
        plan?: {
            code?: string;
            name?: string;
        };
        usage?: {
            messages: UsageMetricRow;
            instagramInbound: UsageMetricRow;
            instagramOutbound: UsageMetricRow;
            instagramCommentReplies: UsageMetricRow;
            aiTokens: UsageMetricRow;
            toolCalls: UsageMetricRow;
            channels: UsageMetricRow;
            seats: UsageMetricRow;
        };
    };
};

function usageClass(metric?: UsageMetricRow): string {
    if (!metric) return "text-slate-700";
    if (metric.hardLimitReached) return "text-rose-700";
    if (metric.softLimitReached) return "text-amber-700";
    return "text-emerald-700";
}

function percent(metric?: UsageMetricRow): string {
    if (!metric || metric.limit <= 0) {
        return "0%";
    }
    return `${Math.min(100, (metric.used / metric.limit) * 100).toFixed(1)}%`;
}

export default function UsagePage() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [payload, setPayload] = useState<UsagePayload["data"] | null>(null);

    useEffect(() => {
        let active = true;

        const load = async () => {
            try {
                const response = await fetch("/api/billing/usage", { cache: "no-store" });
                const data = await response.json() as UsagePayload;
                if (!active) return;

                if (!response.ok || data.success !== true || !data.data) {
                    throw new Error("Gagal memuat usage");
                }

                setPayload(data.data);
                setError(null);
            } catch (err) {
                if (!active) return;
                setError(err instanceof Error ? err.message : "Gagal memuat usage");
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        load();
        const timer = setInterval(load, 10_000);
        return () => {
            active = false;
            clearInterval(timer);
        };
    }, []);

    const rows = useMemo(() => {
        if (!payload?.usage) {
            return [];
        }

        return [
            { label: "Messages", value: payload.usage.messages },
            { label: "Instagram Inbound", value: payload.usage.instagramInbound },
            { label: "Instagram Outbound DM", value: payload.usage.instagramOutbound },
            { label: "Instagram Comment Replies", value: payload.usage.instagramCommentReplies },
            { label: "AI Tokens", value: payload.usage.aiTokens },
            { label: "Tool Calls", value: payload.usage.toolCalls },
            { label: "Channels", value: payload.usage.channels },
            { label: "Seats", value: payload.usage.seats },
        ];
    }, [payload]);

    return (
        <section className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-slate-900">Usage & Quota</h1>
                    <p className="text-sm text-slate-500">Monitoring real-time pemakaian paket workspace.</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                    <p>Plan: {payload?.plan?.name || "-"}</p>
                    <p>Month: {payload?.month || "-"}</p>
                </div>
            </div>

            {loading ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">Loading usage...</div>
            ) : error ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
            ) : (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="overflow-hidden rounded border border-slate-200">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium text-slate-600">Metric</th>
                                    <th className="px-3 py-2 text-left font-medium text-slate-600">Used</th>
                                    <th className="px-3 py-2 text-left font-medium text-slate-600">Limit</th>
                                    <th className="px-3 py-2 text-left font-medium text-slate-600">Usage</th>
                                    <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {rows.map((row) => (
                                    <tr key={row.label}>
                                        <td className="px-3 py-2 text-slate-700">{row.label}</td>
                                        <td className="px-3 py-2 text-slate-700">{row.value.used.toLocaleString("id-ID")}</td>
                                        <td className="px-3 py-2 text-slate-700">{row.value.limit.toLocaleString("id-ID")}</td>
                                        <td className="px-3 py-2 text-slate-700">{percent(row.value)}</td>
                                        <td className={`px-3 py-2 font-medium ${usageClass(row.value)}`}>
                                            {row.value.hardLimitReached
                                                ? "Hard limit reached"
                                                : row.value.softLimitReached
                                                    ? "Soft limit warning"
                                                    : "Normal"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </section>
    );
}
