import Link from "next/link";
import { notFound } from "next/navigation";
import { messageRepo } from "@/lib/db/messageRepo";
import { userRepo } from "@/lib/db/userRepo";
import { upsertUserMemoryAction } from "../../actions";

export default async function UserDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    const user = await userRepo.getUserById(id);
    if (!user) {
        notFound();
    }

    const recentMessages = await messageRepo.getRecentHistory(id, 20);

    return (
        <section className="space-y-5">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-slate-900">User Detail</h1>
                    <p className="text-sm text-slate-500">{user.name || "Tanpa Nama"} · {user.phoneNumber}</p>
                </div>
                <Link href="/users" className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700">
                    Kembali ke Users
                </Link>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <h2 className="text-base font-semibold text-slate-900">Memories</h2>
                    <div className="mt-3 space-y-2">
                        {user.memories.length === 0 ? (
                            <p className="text-sm text-slate-500">Belum ada memory.</p>
                        ) : (
                            user.memories.map((memory) => (
                                <div key={memory.id} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                                    <p className="text-xs font-semibold uppercase text-slate-500">{memory.key}</p>
                                    <p className="mt-1 text-sm text-slate-800">{memory.value}</p>
                                </div>
                            ))
                        )}
                    </div>

                    <form action={upsertUserMemoryAction} className="mt-4 space-y-2">
                        <input type="hidden" name="userId" value={user.id} />
                        <input
                            type="text"
                            name="key"
                            placeholder="memory key"
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            required
                        />
                        <textarea
                            name="value"
                            placeholder="memory value"
                            className="h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            required
                        />
                        <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
                            Simpan Memory
                        </button>
                    </form>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <h2 className="text-base font-semibold text-slate-900">Histori Singkat</h2>
                    <div className="mt-3 space-y-2">
                        {recentMessages.length === 0 ? (
                            <p className="text-sm text-slate-500">Belum ada pesan.</p>
                        ) : (
                            recentMessages.map((message) => (
                                <div key={message.id} className="rounded-md border border-slate-100 p-3">
                                    <p className="text-xs uppercase text-slate-500">{message.role}</p>
                                    <p className="mt-1 text-sm text-slate-800">{message.content}</p>
                                    <p className="mt-1 text-[11px] text-slate-500">
                                        {new Date(message.createdAt).toLocaleString("id-ID")}
                                    </p>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}
