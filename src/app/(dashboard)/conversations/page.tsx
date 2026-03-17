import Link from "next/link";
import { messageRepo } from "@/lib/db/messageRepo";
import { userRepo } from "@/lib/db/userRepo";
import { channelRepo } from "@/lib/db/channelRepo";
import { handoverRepo } from "@/lib/handover/repo";
import {
    resolveUserHandoverAction,
    takeoverInstagramThreadAction,
    toggleInstagramThreadAutoReplyAction,
} from "../actions";
import type { ChatUserDashboardRow } from "@/lib/db/userRepo";
import type { ConversationsSearchParams, PageWithSearchParams } from "@/types/dashboard";
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

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function matchSourceFilter(metadata: Record<string, unknown>, sourceFilter: string): boolean {
    if (!sourceFilter) {
        return true;
    }

    const eventType = readString(metadata.eventType).toLowerCase();
    const provider = readString(metadata.provider).toLowerCase();
    const source = readString(metadata.source).toLowerCase();

    if (sourceFilter === "whatsapp") {
        return provider === "whatsapp" || source.startsWith("wa-");
    }

    if (sourceFilter === "instagram") {
        return provider === "instagram" || source === "instagram" || eventType.startsWith("instagram-");
    }

    return eventType === sourceFilter;
}

function sourceBadgeText(metadata: Record<string, unknown>): string {
    const eventType = readString(metadata.eventType);
    if (eventType) return eventType;
    const source = readString(metadata.source);
    if (source) return source;
    const provider = readString(metadata.provider);
    if (provider) return provider;
    return "unknown";
}

export default async function ConversationsPage({
    searchParams,
}: PageWithSearchParams<ConversationsSearchParams>) {
    const { workspaceId } = await requireSessionPermission("read");
    const params = await searchParams;
    const query = params.q?.trim();
    const label = params.label?.trim() || undefined;
    const channelId = params.channelId?.trim() || undefined;
    const sourceFilter = params.source?.trim().toLowerCase() || "";
    const dateFrom = parseDate(params.dateFrom);
    const dateTo = parseDate(params.dateTo, { endOfDay: true });

    const [users, labels, channels]: [ChatUserDashboardRow[], string[], Awaited<ReturnType<typeof channelRepo.listWorkspaceChannels>>] = await Promise.all([
        userRepo.getUsersForDashboard(workspaceId, { query, label, dateFrom, dateTo, channelId, source: sourceFilter || undefined }),
        userRepo.getDistinctLabels(workspaceId),
        channelRepo.listWorkspaceChannels(workspaceId),
    ]);

    const selectedUser = users.find((u) => u.id === params.userId) ?? users[0];
    const allMessages = selectedUser
        ? await messageRepo.getConversation(workspaceId, selectedUser.id, 1, 500, channelId)
        : [];

    const filteredMessages = allMessages.filter((message) => matchSourceFilter(asRecord(message.metadata), sourceFilter));
    const selectedUserHandoverPending = selectedUser
        ? await handoverRepo.isPending(selectedUser.phoneNumber, workspaceId)
        : false;

    const threadMap = new Map<string, {
        threadId: string;
        eventType: string;
        commentId: string;
        mediaId: string;
        latestAt: Date;
        count: number;
    }>();

    for (const message of filteredMessages) {
        const metadata = asRecord(message.metadata);
        const threadId = readString(metadata.threadId);
        if (!threadId) continue;

        const current = threadMap.get(threadId);
        if (!current) {
            threadMap.set(threadId, {
                threadId,
                eventType: readString(metadata.eventType),
                commentId: readString(metadata.commentId),
                mediaId: readString(metadata.mediaId),
                latestAt: message.createdAt,
                count: 1,
            });
            continue;
        }

        if (message.createdAt > current.latestAt) {
            current.latestAt = message.createdAt;
            current.eventType = readString(metadata.eventType) || current.eventType;
            current.commentId = readString(metadata.commentId) || current.commentId;
            current.mediaId = readString(metadata.mediaId) || current.mediaId;
        }
        current.count += 1;
    }

    const threadItems = Array.from(threadMap.values()).sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime());
    const selectedThreadId = (() => {
        const preferred = params.threadId?.trim() || "";
        if (preferred && threadMap.has(preferred)) {
            return preferred;
        }
        return threadItems[0]?.threadId || "";
    })();

    const isInstagramThreadView = sourceFilter.startsWith("instagram") || (threadItems.length > 0 && selectedUser?.phoneNumber?.startsWith("ig:"));
    const messages = selectedThreadId
        ? filteredMessages.filter((message) => readString(asRecord(message.metadata).threadId) === selectedThreadId)
        : filteredMessages;

    const selectedThreadAutoReply = selectedThreadId
        ? await messageRepo.getInstagramThreadAutoReplyState(workspaceId, selectedThreadId, channelId)
        : null;
    const threadAutoReplyEnabled = selectedThreadAutoReply?.enabled ?? true;

    return (
        <section className="space-y-4">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Conversations</h1>
                <p className="text-sm text-slate-500">Riwayat chat user dengan filter channel/source dan kontrol thread Instagram.</p>
            </div>

            <form className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-7">
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
                <select
                    name="source"
                    defaultValue={sourceFilter || ""}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                    <option value="">Semua source</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="instagram">Instagram (All)</option>
                    <option value="instagram-dm">Instagram DM</option>
                    <option value="instagram-comment">Instagram Comment</option>
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
                <select
                    name="channelId"
                    defaultValue={channelId || ""}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                    <option value="">Semua channel</option>
                    {channels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                            {channel.name} {channel.isPrimary ? "(Primary)" : ""}
                        </option>
                    ))}
                </select>
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
                    <div className="border-b border-slate-200 px-4 py-3 space-y-2">
                        <p className="text-sm font-semibold text-slate-800">
                            {selectedUser ? selectedUser.name || "Tanpa Nama" : "Pilih user"}
                        </p>
                        <p className="text-xs text-slate-500">{selectedUser?.phoneNumber || "-"}</p>
                        {selectedUser && selectedUserHandoverPending ? (
                            <div className="flex items-center gap-2">
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

                        {isInstagramThreadView && selectedUser && selectedThreadId ? (
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-sky-100 px-2 py-1 text-xs text-sky-700">
                                    Thread: {selectedThreadId}
                                </span>
                                <span className={`rounded-full px-2 py-1 text-xs ${
                                    threadAutoReplyEnabled
                                        ? "bg-emerald-100 text-emerald-700"
                                        : "bg-rose-100 text-rose-700"
                                }`}>
                                    Auto Reply: {threadAutoReplyEnabled ? "ON" : "OFF"}
                                </span>
                                <form action={takeoverInstagramThreadAction}>
                                    <input type="hidden" name="userId" value={selectedUser.id} />
                                    <input type="hidden" name="threadId" value={selectedThreadId} />
                                    <input type="hidden" name="channelId" value={channelId || ""} />
                                    <button
                                        type="submit"
                                        className="rounded-md border border-amber-300 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
                                    >
                                        Takeover Thread
                                    </button>
                                </form>
                                <form action={toggleInstagramThreadAutoReplyAction}>
                                    <input type="hidden" name="userId" value={selectedUser.id} />
                                    <input type="hidden" name="threadId" value={selectedThreadId} />
                                    <input type="hidden" name="channelId" value={channelId || ""} />
                                    <input type="hidden" name="enabled" value={threadAutoReplyEnabled ? "false" : "true"} />
                                    <button
                                        type="submit"
                                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                        {threadAutoReplyEnabled ? "Disable Auto Reply" : "Enable Auto Reply"}
                                    </button>
                                </form>
                            </div>
                        ) : null}
                    </div>

                    {isInstagramThreadView && threadItems.length > 0 ? (
                        <div className="border-b border-slate-200 p-3">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Instagram Threads</p>
                            <div className="flex flex-wrap gap-2">
                                {threadItems.map((thread) => {
                                    const active = thread.threadId === selectedThreadId;
                                    return (
                                        <Link
                                            key={thread.threadId}
                                            href={{
                                                pathname: "/conversations",
                                                query: {
                                                    ...params,
                                                    userId: selectedUser?.id,
                                                    threadId: thread.threadId,
                                                },
                                            }}
                                            className={`rounded-md border px-2 py-1 text-xs ${
                                                active
                                                    ? "border-slate-400 bg-slate-100 text-slate-900"
                                                    : "border-slate-200 text-slate-700 hover:bg-slate-50"
                                            }`}
                                        >
                                            {thread.eventType || "instagram"} · {thread.threadId.slice(0, 18)}
                                            <span className="ml-1 text-slate-500">({thread.count})</span>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}

                    <div className="max-h-[70vh] space-y-3 overflow-auto p-4">
                        {messages.length === 0 ? (
                            <p className="text-sm text-slate-500">Belum ada history.</p>
                        ) : (
                            messages.map((message) => {
                                const isUser = message.role === "user";
                                const metadata = asRecord(message.metadata);
                                const outbound = asRecord(metadata.outboundInstagram);
                                return (
                                    <div
                                        key={message.id}
                                        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                                            isUser
                                                ? "bg-slate-100 text-slate-900"
                                                : "ml-auto bg-emerald-100 text-emerald-900"
                                        }`}
                                    >
                                        <p>{message.content}</p>
                                        <p className="mt-1 text-[11px] opacity-80">
                                            source: {sourceBadgeText(metadata)}
                                            {readString(metadata.threadId) ? ` · thread=${readString(metadata.threadId)}` : ""}
                                            {readString(metadata.commentId) ? ` · comment=${readString(metadata.commentId)}` : ""}
                                            {readString(metadata.mediaId) ? ` · media=${readString(metadata.mediaId)}` : ""}
                                        </p>
                                        {readString(metadata.autoReplySkippedReason) ? (
                                            <p className="mt-1 text-[11px] text-amber-700">
                                                skipped: {readString(metadata.autoReplySkippedReason)}
                                            </p>
                                        ) : null}
                                        {readString(String(outbound.status || "")) ? (
                                            <p className="mt-1 text-[11px] text-slate-700">
                                                outbound: {readString(outbound.status)}
                                                {readString(outbound.reasonCode) ? ` (${readString(outbound.reasonCode)})` : ""}
                                            </p>
                                        ) : null}
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
