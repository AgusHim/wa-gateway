import Link from "next/link";
import { resolveUserHandoverAction, toggleUserBlockAction, updateUserLabelAction } from "../actions";
import { userRepo } from "@/lib/db/userRepo";
import { handoverRepo } from "@/lib/handover/repo";
import type { ChatUserDashboardRow } from "@/lib/db/userRepo";
import type { PageWithSearchParams, UsersSearchParams } from "@/types/dashboard";
import { requireSessionPermission } from "@/lib/auth/sessionContext";

function parseDate(value?: string, options?: { endOfDay?: boolean }): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    if (options?.endOfDay) {
        date.setHours(23, 59, 59, 999);
    }
    return date;
}

export default async function UsersPage({
    searchParams,
}: PageWithSearchParams<UsersSearchParams>) {
    const { workspaceId } = await requireSessionPermission("read");
    const params = await searchParams;
    const query = params.q?.trim();
    const label = params.label?.trim() || undefined;
    const dateFrom = parseDate(params.dateFrom);
    const dateTo = parseDate(params.dateTo, { endOfDay: true });

    const [chatUsers, labels]: [ChatUserDashboardRow[], string[]] = await Promise.all([
        userRepo.getUsersForDashboard(workspaceId, { query, label, dateFrom, dateTo }),
        userRepo.getDistinctLabels(workspaceId),
    ]);
    const handoverPendingSet = await handoverRepo.getPendingPhoneSet(
        chatUsers.map((chatUser) => chatUser.phoneNumber),
        workspaceId
    );

    return (
        <section className="space-y-4">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
                <p className="text-sm text-slate-500">Kelola label, status block, dan detail memori user.</p>
            </div>

            <form className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-5">
                <input
                    type="text"
                    name="q"
                    defaultValue={query}
                    placeholder="Search nama / nomor"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <select
                    name="label"
                    defaultValue={label || ""}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                    <option value="">Semua label</option>
                    {labels.map((item) => (
                        <option key={item} value={item}>
                            {item}
                        </option>
                    ))}
                </select>
                <input
                    type="date"
                    name="dateFrom"
                    defaultValue={params.dateFrom || ""}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                    type="date"
                    name="dateTo"
                    defaultValue={params.dateTo || ""}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                    Filter
                </button>
            </form>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="px-4 py-3 text-left font-medium text-slate-600">User</th>
                            <th className="px-4 py-3 text-left font-medium text-slate-600">Label</th>
                            <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
                            <th className="px-4 py-3 text-left font-medium text-slate-600">Pesan</th>
                            <th className="px-4 py-3 text-left font-medium text-slate-600">Aksi</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {chatUsers.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                                    Tidak ada data user.
                                </td>
                            </tr>
                        ) : (
                            chatUsers.map((chatUser) => (
                                <tr key={chatUser.id}>
                                    <td className="px-4 py-3">
                                        <p className="font-medium text-slate-800">{chatUser.name || "Tanpa Nama"}</p>
                                        <p className="text-xs text-slate-500">{chatUser.phoneNumber}</p>
                                    </td>
                                    <td className="px-4 py-3">
                                        <form action={updateUserLabelAction} className="flex items-center gap-2">
                                            <input type="hidden" name="userId" value={chatUser.id} />
                                            <input
                                                type="text"
                                                name="label"
                                                defaultValue={chatUser.label || ""}
                                                placeholder="Label"
                                                className="w-28 rounded-md border border-slate-300 px-2 py-1 text-xs"
                                            />
                                            <button
                                                type="submit"
                                                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                                            >
                                                Save
                                            </button>
                                        </form>
                                    </td>
                                    <td className="px-4 py-3">
                                        {handoverPendingSet.has(chatUser.phoneNumber) ? (
                                            <span className="mr-2 rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-700">
                                                Handover Pending
                                            </span>
                                        ) : null}
                                        <span
                                            className={`rounded-full px-2 py-1 text-xs ${
                                                chatUser.isBlocked
                                                    ? "bg-rose-100 text-rose-700"
                                                    : "bg-emerald-100 text-emerald-700"
                                            }`}
                                        >
                                            {chatUser.isBlocked ? "Blocked" : "Active"}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-slate-700">{chatUser._count.conversations}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <form action={toggleUserBlockAction}>
                                                <input type="hidden" name="userId" value={chatUser.id} />
                                                <input
                                                    type="hidden"
                                                    name="nextBlocked"
                                                    value={chatUser.isBlocked ? "false" : "true"}
                                                />
                                                <button
                                                    type="submit"
                                                    className={`rounded-md px-2 py-1 text-xs font-medium text-white ${
                                                        chatUser.isBlocked
                                                            ? "bg-emerald-600 hover:bg-emerald-500"
                                                            : "bg-rose-600 hover:bg-rose-500"
                                                    }`}
                                                >
                                                    {chatUser.isBlocked ? "Unblock" : "Block"}
                                                </button>
                                            </form>

                                            {handoverPendingSet.has(chatUser.phoneNumber) ? (
                                                <form action={resolveUserHandoverAction}>
                                                    <input type="hidden" name="userId" value={chatUser.id} />
                                                    <button
                                                        type="submit"
                                                        className="rounded-md bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-500"
                                                    >
                                                        Resolve Handover
                                                    </button>
                                                </form>
                                            ) : null}

                                            <Link
                                                href={`/users/${chatUser.id}`}
                                                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                                            >
                                                Detail
                                            </Link>
                                        </div>
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
