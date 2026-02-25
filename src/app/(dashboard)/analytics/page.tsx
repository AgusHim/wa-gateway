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

type AnalyticsSummary = {
    messageVolume: Array<{ date: string; count: number }>;
    topTools: Array<{ toolName: string; count: number }>;
    tokenUsage: Array<{ model: string; totalTokens: number; estimatedCostUsd: number }>;
};

const COLORS = ["#0f766e", "#0369a1", "#4f46e5", "#ea580c", "#be123c", "#15803d"];

export default function AnalyticsPage() {
    const [data, setData] = useState<AnalyticsSummary>({
        messageVolume: [],
        topTools: [],
        tokenUsage: [],
    });

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch("/api/analytics/summary", { cache: "no-store" });
                const payload = (await res.json()) as AnalyticsSummary;
                setData(payload);
            } catch {
                setData({ messageVolume: [], topTools: [], tokenUsage: [] });
            }
        };

        load();
    }, []);

    const totalEstimatedCost = useMemo(
        () => data.tokenUsage.reduce((sum, item) => sum + item.estimatedCostUsd, 0),
        [data.tokenUsage]
    );

    return (
        <section className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Analytics</h1>
                <p className="text-sm text-slate-500">Ringkasan volume pesan, penggunaan tools, dan estimasi biaya model.</p>
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
