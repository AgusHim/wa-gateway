import Link from "next/link";
import { messageRepo } from "@/lib/db/messageRepo";
import { userRepo } from "@/lib/db/userRepo";
import { handoverRepo } from "@/lib/handover/repo";
import { resolveUserHandoverAction } from "../actions";

type SearchParams = {
    q?: string;
    label?: string;
    dateFrom?: string;
    dateTo?: string;
    userId?: string;
};

function parseDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

export default async function ConversationsPage({
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

    const selectedUser = users.find((u) => u.id === params.userId) ?? users[0];
    const messages = selectedUser
        ? await messageRepo.getConversation(selectedUser.id, 1, 200)
        : [];
    const selectedUserHandoverPending = selectedUser
        ? await handoverRepo.isPending(selectedUser.phoneNumber)
        : false;

    return (
        <section className="space-y-4">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Conversations</h1>
                <p className="text-sm text-slate-500">Riwayat chat user dengan filter pencarian.</p>
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

            <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
                <aside className="rounded-lg border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
                        Users ({users.length})
                    </div>
                    <div className="max-h-[70vh] overflow-auto">
                        {users.length === 0 ? (
                            <p className="p-4 text-sm text-slate-500">Tidak ada user.</p>
                        ) : (
                            users.map((user) => {
                                const lastMessage = user.conversations[0];
                                return (
                                    <Link
                                        key={user.id}
                                        href={{
                                            pathname: "/conversations",
                                            query: {
                                                ...params,
                                                userId: user.id,
                                            },
                                        }}
                                        className={`block border-b border-slate-100 px-4 py-3 ${
                                            selectedUser?.id === user.id ? "bg-slate-100" : "hover:bg-slate-50"
                                        }`}
                                    >
                                        <p className="text-sm font-semibold text-slate-800">
                                            {user.name || "Tanpa Nama"}
                                        </p>
                                        <p className="text-xs text-slate-500">{user.phoneNumber}</p>
                                        <p className="mt-1 line-clamp-1 text-xs text-slate-600">
                                            {lastMessage?.content || "Belum ada pesan"}
                                        </p>
                                    </Link>
                                );
                            })
                        )}
                    </div>
                </aside>

                <div className="rounded-lg border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-3">
                        <p className="text-sm font-semibold text-slate-800">
                            {selectedUser ? selectedUser.name || "Tanpa Nama" : "Pilih user"}
                        </p>
                        <p className="text-xs text-slate-500">{selectedUser?.phoneNumber || "-"}</p>
                        {selectedUser && selectedUserHandoverPending ? (
                            <div className="mt-2 flex items-center gap-2">
                                <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-700">
                                    Handover Pending
                                </span>
                                <form action={resolveUserHandoverAction}>
                                    <input type="hidden" name="userId" value={selectedUser.id} />
                                    <button
                                        type="submit"
                                        className="rounded-md bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-500"
                                    >
                                        Resolve Handover
                                    </button>
                                </form>
                            </div>
                        ) : null}
                    </div>

                    <div className="max-h-[70vh] space-y-3 overflow-auto p-4">
                        {messages.length === 0 ? (
                            <p className="text-sm text-slate-500">Belum ada history.</p>
                        ) : (
                            messages.map((message) => {
                                const isUser = message.role === "user";
                                return (
                                    <div
                                        key={message.id}
                                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                                            isUser
                                                ? "bg-slate-100 text-slate-900"
                                                : "ml-auto bg-emerald-100 text-emerald-900"
                                        }`}
                                    >
                                        <p>{message.content}</p>
                                        <p className="mt-1 text-[10px] opacity-70">
                                            {new Date(message.createdAt).toLocaleString("id-ID")}
                                        </p>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}
