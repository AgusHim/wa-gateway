import { KnowledgeSourceStatus, KnowledgeSourceType } from "@prisma/client";
import { archiveKnowledgeSourceAction, uploadKnowledgeSourceAction } from "../actions";
import { requireSessionPermission } from "@/lib/auth/sessionContext";
import { hasTenantPermission } from "@/lib/auth/policy";
import { knowledgeService } from "@/lib/knowledge/service";

function formatDateTime(value: Date): string {
    return new Date(value).toLocaleString("id-ID");
}

export default async function KnowledgePage() {
    const { workspaceId, membershipRole } = await requireSessionPermission("read");
    const canWrite = hasTenantPermission(membershipRole, "write");

    const sources = await knowledgeService.listSources(workspaceId, 200);
    const activeCount = sources.filter((source) => source.status === KnowledgeSourceStatus.ACTIVE).length;
    const archivedCount = sources.length - activeCount;
    const totalChunks = sources.reduce((sum, source) => sum + source._count.chunks, 0);

    return (
        <section className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Knowledge Base</h1>
                <p className="text-sm text-slate-500">Upload knowledge text/file/url, indexing chunk, dan versioning per workspace.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">Active Sources</p>
                    <p className="text-xl font-semibold text-slate-900">{activeCount.toLocaleString("id-ID")}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">Archived Sources</p>
                    <p className="text-xl font-semibold text-slate-900">{archivedCount.toLocaleString("id-ID")}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">Indexed Chunks</p>
                    <p className="text-xl font-semibold text-slate-900">{totalChunks.toLocaleString("id-ID")}</p>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Upload Source</h2>
                <p className="mt-1 text-sm text-slate-500">Untuk URL, sistem akan fetch konten HTML mentah lalu dipecah ke chunk.</p>

                {canWrite ? (
                    <form action={uploadKnowledgeSourceAction} className="mt-4 grid gap-3 md:grid-cols-2" encType="multipart/form-data">
                        <input
                            type="text"
                            name="title"
                            placeholder="Judul knowledge source"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                            required
                        />

                        <select
                            name="type"
                            defaultValue={KnowledgeSourceType.TEXT}
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                            <option value={KnowledgeSourceType.TEXT}>TEXT</option>
                            <option value={KnowledgeSourceType.FILE}>FILE</option>
                            <option value={KnowledgeSourceType.URL}>URL</option>
                        </select>

                        <input
                            type="url"
                            name="sourceUrl"
                            placeholder="https://example.com/docs"
                            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />

                        <textarea
                            name="content"
                            rows={8}
                            placeholder="Konten text knowledge. Wajib untuk TEXT/FILE, optional untuk URL jika mau override fetch."
                            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />

                        <input
                            type="file"
                            name="file"
                            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1"
                        />

                        <button
                            type="submit"
                            className="md:col-span-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                        >
                            Upload & Index
                        </button>
                    </form>
                ) : (
                    <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
                        Role Anda tidak memiliki akses write untuk upload knowledge.
                    </p>
                )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Source Versions</h2>
                <div className="mt-3 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Version</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Title</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Type</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Chunks</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Created</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {sources.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-3 py-5 text-center text-slate-500">
                                        Belum ada knowledge source.
                                    </td>
                                </tr>
                            ) : (
                                sources.map((source) => (
                                    <tr key={source.id}>
                                        <td className="px-3 py-2 text-slate-700">v{source.version}</td>
                                        <td className="px-3 py-2">
                                            <p className="font-medium text-slate-800">{source.title}</p>
                                            {source.sourceUrl ? (
                                                <p className="max-w-md truncate text-xs text-slate-500">{source.sourceUrl}</p>
                                            ) : null}
                                            {source.fileName ? (
                                                <p className="text-xs text-slate-500">{source.fileName}</p>
                                            ) : null}
                                        </td>
                                        <td className="px-3 py-2 text-slate-700">{source.type}</td>
                                        <td className="px-3 py-2 text-slate-700">{source.status}</td>
                                        <td className="px-3 py-2 text-slate-700">{source._count.chunks.toLocaleString("id-ID")}</td>
                                        <td className="px-3 py-2 text-slate-700">{formatDateTime(source.createdAt)}</td>
                                        <td className="px-3 py-2">
                                            {canWrite && source.status === KnowledgeSourceStatus.ACTIVE ? (
                                                <form action={archiveKnowledgeSourceAction}>
                                                    <input type="hidden" name="sourceId" value={source.id} />
                                                    <button
                                                        type="submit"
                                                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700"
                                                    >
                                                        Archive
                                                    </button>
                                                </form>
                                            ) : (
                                                <span className="text-xs text-slate-500">-</span>
                                            )}
                                        </td>
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
