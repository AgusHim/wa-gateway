import Link from "next/link";
import { resolveUserHandoverAction, toggleUserBlockAction, updateUserLabelAction } from "../actions";
import { userRepo } from "@/lib/db/userRepo";
import { handoverRepo } from "@/lib/handover/repo";

type SearchParams = {
    q?: string;
    label?: string;
    dateFrom?: string;
    dateTo?: string;
};

function parseDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

export default async function UsersPage({
    searchParams,
}: {
    searchParams: Promise<SearchParams>;
}) {
    const params = await searchParams;
    const query = params.q?.trim();
    const label = params.label?.trim() || undefined;
    const dateFrom = parseDate(params.dateFrom);
    const dateTo = parseDate(params.dateTo);

    const [users, labels] = await Promise.all([
        userRepo.getUsersForDashboard({ query, label, dateFrom, dateTo }),
        userRepo.getDistinctLabels(),
    ]);
    const handoverPendingSet = await handoverRepo.getPendingPhoneSet(users.map((user) => user.phoneNumber));

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
                        {users.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                                    Tidak ada data user.
                                </td>
                            </tr>
                        ) : (
                            users.map((user) => (
                                <tr key={user.id}>
                                    <td className="px-4 py-3">
                                        <p className="font-medium text-slate-800">{user.name || "Tanpa Nama"}</p>
                                        <p className="text-xs text-slate-500">{user.phoneNumber}</p>
                                    </td>
                                    <td className="px-4 py-3">
                                        <form action={updateUserLabelAction} className="flex items-center gap-2">
                                            <input type="hidden" name="userId" value={user.id} />
                                            <input
                                                type="text"
                                                name="label"
                                                defaultValue={user.label || ""}
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
                                        {handoverPendingSet.has(user.phoneNumber) ? (
                                            <span className="mr-2 rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-700">
                                                Handover Pending
                                            </span>
                                        ) : null}
                                        <span
                                            className={`rounded-full px-2 py-1 text-xs ${
                                                user.isBlocked
                                                    ? "bg-rose-100 text-rose-700"
                                                    : "bg-emerald-100 text-emerald-700"
                                            }`}
                                        >
                                            {user.isBlocked ? "Blocked" : "Active"}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-slate-700">{user._count.conversations}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <form action={toggleUserBlockAction}>
                                                <input type="hidden" name="userId" value={user.id} />
                                                <input
                                                    type="hidden"
                                                    name="nextBlocked"
                                                    value={user.isBlocked ? "false" : "true"}
                                                />
                                                <button
                                                    type="submit"
                                                    className={`rounded-md px-2 py-1 text-xs font-medium text-white ${
                                                        user.isBlocked
                                                            ? "bg-emerald-600 hover:bg-emerald-500"
                                                            : "bg-rose-600 hover:bg-rose-500"
                                                    }`}
                                                >
                                                    {user.isBlocked ? "Unblock" : "Block"}
                                                </button>
                                            </form>

                                            {handoverPendingSet.has(user.phoneNumber) ? (
                                                <form action={resolveUserHandoverAction}>
                                                    <input type="hidden" name="userId" value={user.id} />
                                                    <button
                                                        type="submit"
                                                        className="rounded-md bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-500"
                                                    >
                                                        Resolve Handover
                                                    </button>
                                                </form>
                                            ) : null}

                                            <Link
                                                href={`/users/${user.id}`}
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
