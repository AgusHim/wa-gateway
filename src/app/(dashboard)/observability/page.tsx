import { replayDeadLetterJobAction } from "../actions";
import { requireSessionPermission } from "@/lib/auth/sessionContext";
import { hasTenantPermission } from "@/lib/auth/policy";
import { listWorkspaceDeadLetters } from "@/lib/observability/deadLetter";
import { getMetricsSnapshot } from "@/lib/observability/metrics";
import { listWorkerRuntimeSnapshots } from "@/lib/observability/workerRuntime";
import { listCircuitBreakerSnapshots } from "@/lib/resilience/circuitBreaker";
import type { PageWithSearchParams } from "@/types/dashboard";

type ObservabilitySearchParams = {
    windowMinutes?: string;
    replay?: string;
    direction?: string;
};

function parseWindowMinutes(value?: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return 15;
    }

    return Math.max(1, Math.min(24 * 60, Math.round(parsed)));
}

function formatDateTime(value?: number | string | Date | null): string {
    if (!value) {
        return "-";
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    return date.toLocaleString("id-ID");
}

function formatNumber(value: number, fractionDigits = 0): string {
    return value.toLocaleString("id-ID", {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    });
}

function totalPendingDlq(counts: Record<"wait" | "active" | "delayed" | "failed" | "completed", number>): number {
    return counts.wait + counts.active + counts.delayed + counts.failed;
}

function isWorkspaceCircuitBreaker(key: string, workspaceId: string): boolean {
    return key.includes(`:${workspaceId}:`) || key.startsWith(`ai:${workspaceId}:`);
}

function sanitizeQueuePart(value: string): string {
    return value.trim().replace(/:/g, "_");
}

const WINDOW_OPTIONS = [15, 60, 360, 1440];

export default async function ObservabilityPage({
    searchParams,
}: PageWithSearchParams<ObservabilitySearchParams>) {
    const context = await requireSessionPermission("read");
    const params = await searchParams;
    const windowMinutes = parseWindowMinutes(params.windowMinutes);
    const canReplay = hasTenantPermission(context.membershipRole, "manage_channel");
    const workspaceQueuePart = sanitizeQueuePart(context.workspaceId);

    const [metrics, deadLetters] = await Promise.all([
        getMetricsSnapshot(windowMinutes, { workspaceId: context.workspaceId }),
        listWorkspaceDeadLetters(context.workspaceId, 25),
    ]);

    const circuitBreakers = listCircuitBreakerSnapshots()
        .filter((snapshot) => isWorkspaceCircuitBreaker(snapshot.key, context.workspaceId))
        .sort((a, b) => {
            if (a.state === b.state) {
                return (b.failureCount || 0) - (a.failureCount || 0);
            }
            return a.state === "open" ? -1 : 1;
        });
    const workerRuntimes = listWorkerRuntimeSnapshots()
        .filter((snapshot) => snapshot.queueName.includes(`--${workspaceQueuePart}--`));

    const totalOutboundDlq = deadLetters.outbound.reduce((sum, item) => sum + totalPendingDlq(item.counts), 0);

    return (
        <section className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold text-slate-900">Observability</h1>
                    <p className="text-sm text-slate-500">
                        Metrics operasional, circuit breaker, dan dead-letter queue per workspace.
                    </p>
                </div>

                <form className="flex items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
                    <label className="text-sm text-slate-600">
                        Window
                        <select
                            name="windowMinutes"
                            defaultValue={String(windowMinutes)}
                            className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                            {WINDOW_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                    {option >= 60 ? `${option / 60} jam` : `${option} menit`}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                        Apply
                    </button>
                </form>
            </div>

            {params.replay === "success" ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    Replay DLQ berhasil dijalankan untuk arah {params.direction || "unknown"}.
                </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Queue Lag Avg</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(metrics.queueLagAvgMs, 2)} ms</p>
                    <p className="mt-1 text-sm text-slate-500">{formatNumber(metrics.totals.queueLagSamples)} samples</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Worker Throughput</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(metrics.workerThroughputPerMinute, 2)}/min</p>
                    <p className="mt-1 text-sm text-slate-500">
                        {formatNumber(metrics.totals.workerProcessed)} success / {formatNumber(metrics.totals.workerFailed)} failed
                    </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">AI Latency Avg</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(metrics.aiLatencyAvgMs, 2)} ms</p>
                    <p className="mt-1 text-sm text-slate-500">{formatNumber(metrics.totals.aiLatencySamples)} invocations</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Delivery Success</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(metrics.deliverySuccessRate, 2)}%</p>
                    <p className="mt-1 text-sm text-slate-500">
                        {formatNumber(metrics.totals.deliverySuccess)} success / {formatNumber(metrics.totals.deliveryFailed)} failed
                    </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pending DLQ</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">
                        {formatNumber(totalPendingDlq(deadLetters.inbound.counts) + totalOutboundDlq)}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                        Inbound {formatNumber(totalPendingDlq(deadLetters.inbound.counts))} / Outbound {formatNumber(totalOutboundDlq)}
                    </p>
                </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="mb-3">
                        <h2 className="text-base font-semibold text-slate-900">Queue Breakdown</h2>
                        <p className="text-sm text-slate-500">Queue partition yang aktif di window terpilih.</p>
                    </div>
                    <div className="overflow-hidden rounded border border-slate-200">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium text-slate-600">Queue</th>
                                    <th className="px-3 py-2 text-left font-medium text-slate-600">Processed</th>
                                    <th className="px-3 py-2 text-left font-medium text-slate-600">Failed</th>
                                    <th className="px-3 py-2 text-left font-medium text-slate-600">Lag Avg</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {metrics.queueBreakdown.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                                            Belum ada activity queue pada window ini.
                                        </td>
                                    </tr>
                                ) : (
                                    metrics.queueBreakdown.slice(0, 12).map((queue) => (
                                        <tr key={queue.queueName}>
                                            <td className="px-3 py-2 font-mono text-xs text-slate-700">{queue.queueName}</td>
                                            <td className="px-3 py-2 text-slate-700">{formatNumber(queue.processed)}</td>
                                            <td className="px-3 py-2 text-slate-700">{formatNumber(queue.failed)}</td>
                                            <td className="px-3 py-2 text-slate-700">{formatNumber(queue.lagAvgMs, 2)} ms</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="mb-3">
                        <h2 className="text-base font-semibold text-slate-900">Circuit Breakers</h2>
                        <p className="text-sm text-slate-500">Snapshot breaker AI/tool yang terkait workspace ini.</p>
                    </div>
                    <div className="overflow-hidden rounded border border-slate-200">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium text-slate-600">Key</th>
                                    <th className="px-3 py-2 text-left font-medium text-slate-600">State</th>
                                    <th className="px-3 py-2 text-left font-medium text-slate-600">Failures</th>
                                    <th className="px-3 py-2 text-left font-medium text-slate-600">Next Attempt</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {circuitBreakers.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                                            Belum ada circuit breaker state untuk workspace ini.
                                        </td>
                                    </tr>
                                ) : (
                                    circuitBreakers.map((breaker) => (
                                        <tr key={breaker.key}>
                                            <td className="px-3 py-2 font-mono text-xs text-slate-700">{breaker.key}</td>
                                            <td className="px-3 py-2">
                                                <span
                                                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                                                        breaker.state === "open"
                                                            ? "bg-rose-100 text-rose-700"
                                                            : breaker.state === "half_open"
                                                                ? "bg-amber-100 text-amber-700"
                                                                : "bg-emerald-100 text-emerald-700"
                                                    }`}
                                                >
                                                    {breaker.state}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-slate-700">{formatNumber(breaker.failureCount)}</td>
                                            <td className="px-3 py-2 text-slate-700">{formatDateTime(breaker.nextAttemptAt)}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-3">
                    <h2 className="text-base font-semibold text-slate-900">Worker Runtime</h2>
                    <p className="text-sm text-slate-500">Concurrency aktif hasil autoscaling per queue partition.</p>
                </div>
                <div className="overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Queue</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Type</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Concurrency</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Backlog</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Updated</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {workerRuntimes.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                                        Belum ada worker runtime aktif untuk workspace ini.
                                    </td>
                                </tr>
                            ) : (
                                workerRuntimes.map((snapshot) => (
                                    <tr key={snapshot.queueName}>
                                        <td className="px-3 py-2 font-mono text-xs text-slate-700">{snapshot.queueName}</td>
                                        <td className="px-3 py-2 text-slate-700">{snapshot.workerType}</td>
                                        <td className="px-3 py-2 text-slate-700">
                                            {formatNumber(snapshot.concurrency)} ({formatNumber(snapshot.minConcurrency)}-{formatNumber(snapshot.maxConcurrency)})
                                        </td>
                                        <td className="px-3 py-2 text-slate-700">
                                            {formatNumber(snapshot.lastBacklog)} / target {formatNumber(snapshot.targetBacklog)}
                                        </td>
                                        <td className="px-3 py-2 text-slate-700">{formatDateTime(snapshot.updatedAt)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-base font-semibold text-slate-900">Inbound DLQ</h2>
                        <p className="text-sm text-slate-500">Job inbound permanen gagal yang bisa direplay ke queue partition.</p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                        <span className="rounded-full bg-slate-100 px-2 py-1">wait {formatNumber(deadLetters.inbound.counts.wait)}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1">active {formatNumber(deadLetters.inbound.counts.active)}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1">delayed {formatNumber(deadLetters.inbound.counts.delayed)}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1">failed {formatNumber(deadLetters.inbound.counts.failed)}</span>
                    </div>
                </div>
                <div className="overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">State</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Channel</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Failed At</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Reason</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {deadLetters.inbound.jobs.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                                        Inbound DLQ kosong.
                                    </td>
                                </tr>
                            ) : (
                                deadLetters.inbound.jobs.map((job) => (
                                    <tr key={job.id}>
                                        <td className="px-3 py-2 text-slate-700">{job.state}</td>
                                        <td className="px-3 py-2 text-slate-700">{job.data.channelId || "-"}</td>
                                        <td className="px-3 py-2 text-slate-700">{formatDateTime(job.data.failedAt || job.timestamp)}</td>
                                        <td className="px-3 py-2 text-slate-700">{job.data.failedReason || job.failedReason || "-"}</td>
                                        <td className="px-3 py-2">
                                            {canReplay ? (
                                                <form action={replayDeadLetterJobAction}>
                                                    <input type="hidden" name="direction" value="inbound" />
                                                    <input type="hidden" name="dlqJobId" value={job.id} />
                                                    <input type="hidden" name="windowMinutes" value={String(windowMinutes)} />
                                                    <button
                                                        type="submit"
                                                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                                                    >
                                                        Replay
                                                    </button>
                                                </form>
                                            ) : (
                                                <span className="text-xs text-slate-400">read-only</span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-3">
                    <h2 className="text-base font-semibold text-slate-900">Outbound DLQ</h2>
                    <p className="text-sm text-slate-500">Queue per channel untuk pengiriman outbound yang gagal permanen.</p>
                </div>

                <div className="space-y-4">
                    {deadLetters.outbound.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                            Workspace ini belum memiliki channel outbound.
                        </p>
                    ) : (
                        deadLetters.outbound.map((channel) => (
                            <div key={channel.channelId} className="rounded-lg border border-slate-200">
                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                                    <div>
                                        <p className="font-medium text-slate-900">{channel.channelName}</p>
                                        <p className="font-mono text-xs text-slate-500">{channel.queueName}</p>
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                                        <span className="rounded-full bg-white px-2 py-1">wait {formatNumber(channel.counts.wait)}</span>
                                        <span className="rounded-full bg-white px-2 py-1">active {formatNumber(channel.counts.active)}</span>
                                        <span className="rounded-full bg-white px-2 py-1">delayed {formatNumber(channel.counts.delayed)}</span>
                                        <span className="rounded-full bg-white px-2 py-1">failed {formatNumber(channel.counts.failed)}</span>
                                    </div>
                                </div>

                                <div className="overflow-hidden rounded-b-lg">
                                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                                        <thead className="bg-white">
                                            <tr>
                                                <th className="px-3 py-2 text-left font-medium text-slate-600">State</th>
                                                <th className="px-3 py-2 text-left font-medium text-slate-600">Phone</th>
                                                <th className="px-3 py-2 text-left font-medium text-slate-600">Failed At</th>
                                                <th className="px-3 py-2 text-left font-medium text-slate-600">Reason</th>
                                                <th className="px-3 py-2 text-left font-medium text-slate-600">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {channel.jobs.length === 0 ? (
                                                <tr>
                                                    <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                                                        Outbound DLQ kosong.
                                                    </td>
                                                </tr>
                                            ) : (
                                                channel.jobs.map((job) => (
                                                    <tr key={job.id}>
                                                        <td className="px-3 py-2 text-slate-700">{job.state}</td>
                                                        <td className="px-3 py-2 text-slate-700">{job.data.payload.phoneNumber}</td>
                                                        <td className="px-3 py-2 text-slate-700">{formatDateTime(job.data.failedAt || job.timestamp)}</td>
                                                        <td className="px-3 py-2 text-slate-700">{job.data.failedReason || job.failedReason || "-"}</td>
                                                        <td className="px-3 py-2">
                                                            {canReplay ? (
                                                                <form action={replayDeadLetterJobAction}>
                                                                    <input type="hidden" name="direction" value="outbound" />
                                                                    <input type="hidden" name="channelId" value={channel.channelId} />
                                                                    <input type="hidden" name="dlqJobId" value={job.id} />
                                                                    <input type="hidden" name="windowMinutes" value={String(windowMinutes)} />
                                                                    <button
                                                                        type="submit"
                                                                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                                                                    >
                                                                        Replay
                                                                    </button>
                                                                </form>
                                                            ) : (
                                                                <span className="text-xs text-slate-400">read-only</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </section>
    );
}
