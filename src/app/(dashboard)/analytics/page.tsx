"use client";

import { useEffect, useMemo, useState } from "react";
import {
    Bar,
    BarChart,
    Cell,
    CartesianGrid,
    Legend,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import {
    EMPTY_ANALYTICS_SUMMARY,
    parseAnalyticsSummary,
    type AnalyticsSummary,
} from "@/types/dashboard";

const COLORS = ["#0f766e", "#0369a1", "#4f46e5", "#ea580c", "#be123c", "#15803d"];

function toDateInputValue(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export default function AnalyticsPage() {
    const [data, setData] = useState<AnalyticsSummary>(EMPTY_ANALYTICS_SUMMARY);
    const [dateTo, setDateTo] = useState(() => toDateInputValue(new Date()));
    const [dateFrom, setDateFrom] = useState(() => {
        const start = new Date();
        start.setDate(start.getDate() - 6);
        return toDateInputValue(start);
    });

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch("/api/analytics/summary", { cache: "no-store" });
                const payload = parseAnalyticsSummary(await res.json());
                setData(payload ?? EMPTY_ANALYTICS_SUMMARY);
            } catch {
                setData(EMPTY_ANALYTICS_SUMMARY);
            }
        };

        load();
    }, []);

    const totalEstimatedCost = useMemo(
        () => data.tokenUsage.reduce((sum, item) => sum + item.estimatedCostUsd, 0),
        [data.tokenUsage]
    );
    const exportHref = useMemo(() => {
        const params = new URLSearchParams();
        params.set("dateFrom", dateFrom);
        params.set("dateTo", dateTo);
        return `/api/analytics/instagram/export?${params.toString()}`;
    }, [dateFrom, dateTo]);

    return (
        <section className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Analytics</h1>
                <p className="text-sm text-slate-500">Ringkasan volume pesan, penggunaan tools, dan estimasi biaya model.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">IG Delivery Success</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">
                        {data.instagramDelivery.successRate.toFixed(2)}%
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                        {data.instagramDelivery.successCount} sent / {data.instagramDelivery.failedCount} failed
                    </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">IG Avg Response Time</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">
                        {data.instagramKpis.avgResponseTimeMs.toLocaleString("id-ID")} ms
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                        DM: {data.instagramKpis.dmCount.toLocaleString("id-ID")} | Comment: {data.instagramKpis.commentCount.toLocaleString("id-ID")}
                    </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">IG Auto vs Human</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">
                        {data.instagramKpis.autoReplyRatio.toFixed(2)}%
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                        Auto: {data.instagramKpis.autoReplyCount.toLocaleString("id-ID")} | Human: {data.instagramKpis.humanHandledCount.toLocaleString("id-ID")}
                    </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 md:col-span-2">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">IG Top Fail Reasons</p>
                    {data.instagramDelivery.topFailReasons.length === 0 ? (
                        <p className="text-sm text-slate-500">Belum ada outbound gagal di periode ini.</p>
                    ) : (
                        <div className="overflow-hidden rounded border border-slate-200">
                            <table className="min-w-full divide-y divide-slate-200 text-sm">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium text-slate-600">Reason</th>
                                        <th className="px-3 py-2 text-left font-medium text-slate-600">Count</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {data.instagramDelivery.topFailReasons.map((item) => (
                                        <tr key={item.reason}>
                                            <td className="px-3 py-2 text-slate-800">{item.reason}</td>
                                            <td className="px-3 py-2 text-slate-700">{item.count.toLocaleString("id-ID")}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 className="text-base font-semibold text-slate-900">Instagram Conversation Export (CSV)</h2>
                        <p className="text-sm text-slate-500">Ekspor percakapan Instagram per rentang tanggal.</p>
                    </div>
                    <a
                        href={exportHref}
                        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                    >
                        Download CSV
                    </a>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm text-slate-600">
                        Date from
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(event) => setDateFrom(event.target.value)}
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                    </label>
                    <label className="text-sm text-slate-600">
                        Date to
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(event) => setDateTo(event.target.value)}
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                    </label>
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <h2 className="mb-3 text-base font-semibold text-slate-900">Volume Pesan (7 hari)</h2>
                    <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.messageVolume}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="date" />
                                <YAxis allowDecimals={false} />
                                <Tooltip />
                                <Bar dataKey="count" fill="#0f766e" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <h2 className="mb-3 text-base font-semibold text-slate-900">Distribusi Tool Calls</h2>
                    <div className="h-72">
                        {data.topTools.length === 0 ? (
                            <p className="text-sm text-slate-500">Belum ada data tool usage.</p>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={data.topTools} dataKey="count" nameKey="toolName" outerRadius={100} label>
                                        {data.topTools.map((entry, index) => (
                                            <Cell key={`${entry.toolName}-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Instagram Content Insight (Top Media)</h2>
                <div className="mt-3 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Media ID</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Inbound Comment</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Bot Reply</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {data.instagramContentInsights.length === 0 ? (
                                <tr>
                                    <td colSpan={3} className="px-3 py-4 text-center text-slate-500">
                                        Belum ada data insight media.
                                    </td>
                                </tr>
                            ) : (
                                data.instagramContentInsights.map((item) => (
                                    <tr key={item.mediaId}>
                                        <td className="px-3 py-2 text-slate-700">{item.mediaId}</td>
                                        <td className="px-3 py-2 text-slate-700">{item.inboundCommentCount.toLocaleString("id-ID")}</td>
                                        <td className="px-3 py-2 text-slate-700">{item.botReplyCount.toLocaleString("id-ID")}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-base font-semibold text-slate-900">Token Usage & Cost Estimate</h2>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                        Total Estimasi: ${totalEstimatedCost.toFixed(4)}
                    </span>
                </div>

                <div className="overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">Model</th>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">Total Tokens</th>
                                <th className="px-4 py-3 text-left font-medium text-slate-600">Estimated Cost (USD)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {data.tokenUsage.length === 0 ? (
                                <tr>
                                    <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                                        Belum ada metadata token usage.
                                    </td>
                                </tr>
                            ) : (
                                data.tokenUsage.map((item) => (
                                    <tr key={item.model}>
                                        <td className="px-4 py-3 text-slate-800">{item.model}</td>
                                        <td className="px-4 py-3 text-slate-700">{item.totalTokens.toLocaleString("id-ID")}</td>
                                        <td className="px-4 py-3 text-slate-700">${item.estimatedCostUsd.toFixed(4)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
}
