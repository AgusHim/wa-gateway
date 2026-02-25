import { toolLogRepo } from "@/lib/db/toolLogRepo";

type SearchParams = {
    toolName?: string;
    status?: "success" | "failed";
};

export default async function ToolLogsPage({
    searchParams,
}: {
    searchParams: Promise<SearchParams>;
}) {
    const params = await searchParams;
    const toolName = params.toolName?.trim() || undefined;
    const success = params.status
        ? params.status === "success"
        : undefined;

    const [toolNames, logs] = await Promise.all([
        toolLogRepo.getDistinctToolNames(),
        toolLogRepo.getToolLogs({ toolName, success, limit: 200 }),
    ]);

    return (
        <section className="space-y-4">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Tool Logs</h1>
                <p className="text-sm text-slate-500">Histori pemanggilan tools AI dan hasil eksekusinya.</p>
            </div>

            <form className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3">
                <select
                    name="toolName"
                    defaultValue={toolName || ""}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                    <option value="">Semua tool</option>
                    {toolNames.map((name) => (
                        <option key={name} value={name}>
                            {name}
                        </option>
                    ))}
                </select>

                <select
                    name="status"
                    defaultValue={params.status || ""}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                    <option value="">Semua status</option>
                    <option value="success">Success</option>
                    <option value="failed">Failed</option>
                </select>

                <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                    Filter
                </button>
            </form>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="px-4 py-3 text-left font-medium text-slate-600">Tool</th>
                            <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
                            <th className="px-4 py-3 text-left font-medium text-slate-600">Durasi</th>
                            <th className="px-4 py-3 text-left font-medium text-slate-600">Input</th>
                            <th className="px-4 py-3 text-left font-medium text-slate-600">Output</th>
                            <th className="px-4 py-3 text-left font-medium text-slate-600">Waktu</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {logs.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                                    Belum ada log.
                                </td>
                            </tr>
                        ) : (
                            logs.map((log) => (
                                <tr key={log.id}>
                                    <td className="px-4 py-3 font-medium text-slate-800">{log.toolName}</td>
                                    <td className="px-4 py-3">
                                        <span
                                            className={`rounded-full px-2 py-1 text-xs ${
                                                log.success
                                                    ? "bg-emerald-100 text-emerald-700"
                                                    : "bg-rose-100 text-rose-700"
                                            }`}
                                        >
                                            {log.success ? "Success" : "Failed"}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-slate-700">{log.duration} ms</td>
                                    <td className="px-4 py-3">
                                        <pre className="max-w-xs overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
                                            {JSON.stringify(log.input, null, 2)}
                                        </pre>
                                    </td>
                                    <td className="px-4 py-3">
                                        <pre className="max-w-xs overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
                                            {JSON.stringify(log.output, null, 2)}
                                        </pre>
                                    </td>
                                    <td className="px-4 py-3 text-slate-600">
                                        {new Date(log.createdAt).toLocaleString("id-ID")}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
