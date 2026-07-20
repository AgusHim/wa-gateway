"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    AlertCircle,
    Check,
    CheckCheck,
    Clock3,
    Download,
    FileText,
    LoaderCircle,
    RefreshCw,
    Send,
    UserRoundCheck,
    Wifi,
    WifiOff,
} from "lucide-react";
import type { AttachmentView } from "@/lib/media/types";

export type ConversationMessageView = {
    id: string;
    userId: string;
    channelId: string | null;
    role: string;
    content: string;
    source: string | null;
    deliveryStatus: string | null;
    externalMessageId: string | null;
    createdAt: string;
    updatedAt: string;
    attachments: AttachmentView[];
};

export type ConversationUserView = {
    id: string;
    name: string;
    phoneNumber: string;
    lastMessage: string;
    lastMessageAt: string | null;
    href: string;
};

type Props = {
    users: ConversationUserView[];
    selectedUser: { id: string; name: string; phoneNumber: string } | null;
    channel: { id: string; name: string; isEnabled: boolean };
    initialConnectionStatus: "open" | "close" | "connecting";
    initialMessages: ConversationMessageView[];
    initialNextCursor: string | null;
    initialHandoverPending: boolean;
    canWrite: boolean;
};

type ApiEnvelope = {
    success: boolean;
    message?: string;
    data?: {
        messages?: ConversationMessageView[];
        nextCursor?: string | null;
        handoverPending?: boolean;
    } | ConversationMessageView;
};

function formatBytes(value: number | null): string {
    if (value === null || value < 0) return "Ukuran tidak tersedia";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function deliveryIcon(status: string | null) {
    if (status === "sent") return <CheckCheck className="h-3.5 w-3.5" aria-label="Terkirim" />;
    if (status === "failed") return <AlertCircle className="h-3.5 w-3.5" aria-label="Gagal" />;
    if (status === "queued") return <Clock3 className="h-3.5 w-3.5" aria-label="Dalam antrean" />;
    return <Check className="h-3.5 w-3.5" aria-label="Tersimpan" />;
}

function Attachment({ attachment }: { attachment: AttachmentView }) {
    if (attachment.status !== "ready" || !attachment.url) {
        return (
            <div className="mt-2 flex min-h-12 items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Media tidak tersedia
            </div>
        );
    }

    if (attachment.type === "sticker") {
        return (
            <div className="mt-2 h-40 w-40 overflow-hidden rounded-md bg-white/70">
                <Image
                    src={attachment.url}
                    alt="Stiker WhatsApp"
                    width={160}
                    height={160}
                    unoptimized
                    className="h-full w-full object-contain"
                />
            </div>
        );
    }

    if (attachment.type === "audio") {
        return (
            <div className="mt-2 w-full min-w-64 max-w-md">
                <audio controls preload="metadata" className="h-10 w-full" src={attachment.url}>
                    Browser tidak mendukung pemutar audio.
                </audio>
                <p className="mt-1 text-[11px] opacity-70">
                    {attachment.fileName || "Audio WhatsApp"} · {formatBytes(attachment.byteSize)}
                </p>
            </div>
        );
    }

    return (
        <a
            href={attachment.url}
            className="mt-2 flex min-h-14 items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800 hover:bg-slate-50"
        >
            <FileText className="h-5 w-5 shrink-0 text-slate-500" />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{attachment.fileName || "Dokumen WhatsApp"}</span>
                <span className="block truncate text-[11px] text-slate-500">
                    {attachment.mimeType} · {formatBytes(attachment.byteSize)}
                </span>
            </span>
            <Download className="h-4 w-4 shrink-0" aria-label="Download file" />
        </a>
    );
}

function readApiMessage(payload: ApiEnvelope, fallback: string): string {
    return typeof payload.message === "string" && payload.message.trim() ? payload.message : fallback;
}

export function WhatsAppConversationInbox({
    users,
    selectedUser,
    channel,
    initialConnectionStatus,
    initialMessages,
    initialNextCursor,
    initialHandoverPending,
    canWrite,
}: Props) {
    const [messages, setMessages] = useState(initialMessages);
    const [nextCursor, setNextCursor] = useState(initialNextCursor);
    const [handoverPending, setHandoverPending] = useState(initialHandoverPending);
    const [connectionStatus, setConnectionStatus] = useState(initialConnectionStatus);
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [resolvingHandover, setResolvingHandover] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const messageEndRef = useRef<HTMLDivElement | null>(null);
    const listRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const router = useRouter();

    useEffect(() => {
        setMessages(initialMessages);
        setNextCursor(initialNextCursor);
        setHandoverPending(initialHandoverPending);
    }, [initialHandoverPending, initialMessages, initialNextCursor, selectedUser?.id, channel.id]);

    const fetchLatest = useCallback(async () => {
        if (!selectedUser) return;
        const response = await fetch(
            `/api/conversations/${encodeURIComponent(selectedUser.id)}/messages?channelId=${encodeURIComponent(channel.id)}&limit=50`,
            { cache: "no-store" }
        );
        if (!response.ok) return;
        const payload = await response.json() as ApiEnvelope;
        if (!payload.success || !payload.data || Array.isArray(payload.data) || !("messages" in payload.data)) return;
        setMessages(payload.data.messages || []);
        setNextCursor(payload.data.nextCursor || null);
        setHandoverPending(Boolean(payload.data.handoverPending));
    }, [channel.id, selectedUser]);

    useEffect(() => {
        const source = new EventSource("/api/sse");
        const refreshSelected = (event: Event) => {
            if (!(event instanceof MessageEvent)) return;
            try {
                const payload = JSON.parse(event.data) as { channelId?: string; userId?: string };
                if (payload.channelId !== channel.id) return;
                if (listRefreshTimerRef.current) clearTimeout(listRefreshTimerRef.current);
                listRefreshTimerRef.current = setTimeout(() => router.refresh(), 250);
                if (selectedUser && payload.userId === selectedUser.id) {
                    void fetchLatest();
                }
            } catch {
                // Ignore malformed events and keep the stream alive.
            }
        };
        const updateStatus = (event: Event) => {
            if (!(event instanceof MessageEvent)) return;
            try {
                const payload = JSON.parse(event.data) as { channelId?: string; status?: "open" | "close" | "connecting" };
                if (payload.channelId === channel.id && payload.status) setConnectionStatus(payload.status);
            } catch {
                // Ignore malformed events and keep the stream alive.
            }
        };
        source.addEventListener("conversation-message", refreshSelected);
        source.addEventListener("conversation-status", refreshSelected);
        source.addEventListener("connection-update", updateStatus);
        return () => {
            source.close();
            if (listRefreshTimerRef.current) clearTimeout(listRefreshTimerRef.current);
        };
    }, [channel.id, fetchLatest, router, selectedUser]);

    useEffect(() => {
        messageEndRef.current?.scrollIntoView({ block: "end" });
    }, [messages.length, selectedUser?.id]);

    const loadOlder = async () => {
        if (!selectedUser || !nextCursor || loadingOlder) return;
        setLoadingOlder(true);
        setError(null);
        try {
            const response = await fetch(
                `/api/conversations/${encodeURIComponent(selectedUser.id)}/messages?channelId=${encodeURIComponent(channel.id)}&limit=50&cursor=${encodeURIComponent(nextCursor)}`,
                { cache: "no-store" }
            );
            const payload = await response.json() as ApiEnvelope;
            if (!response.ok || !payload.success || !payload.data || Array.isArray(payload.data) || !("messages" in payload.data)) {
                throw new Error(readApiMessage(payload, "Gagal memuat pesan lama"));
            }
            const older = payload.data.messages || [];
            setMessages((current) => [...older, ...current.filter((item) => !older.some((old) => old.id === item.id))]);
            setNextCursor(payload.data.nextCursor || null);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Gagal memuat pesan lama");
        } finally {
            setLoadingOlder(false);
        }
    };

    const sendReply = async () => {
        const normalized = text.trim();
        if (!selectedUser || !normalized || sending) return;
        const idempotencyKey = crypto.randomUUID();
        const temporaryId = `temporary:${idempotencyKey}`;
        const optimistic: ConversationMessageView = {
            id: temporaryId,
            userId: selectedUser.id,
            channelId: channel.id,
            role: "assistant",
            content: normalized,
            source: "human-operator",
            deliveryStatus: "queued",
            externalMessageId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attachments: [],
        };

        setSending(true);
        setError(null);
        setText("");
        setHandoverPending(true);
        setMessages((current) => [...current, optimistic]);
        try {
            const response = await fetch(`/api/conversations/${encodeURIComponent(selectedUser.id)}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ channelId: channel.id, text: normalized, idempotencyKey }),
            });
            const payload = await response.json() as ApiEnvelope;
            const message = payload.data && !Array.isArray(payload.data) && !("messages" in payload.data)
                ? payload.data as ConversationMessageView
                : null;
            if (!response.ok || !payload.success || !message) {
                if (message) {
                    setMessages((current) => current.map((item) => item.id === temporaryId ? message : item));
                }
                throw new Error(readApiMessage(payload, "Gagal mengirim balasan"));
            }
            setMessages((current) => current.map((item) => item.id === temporaryId ? message : item));
        } catch (sendError) {
            setMessages((current) => current.map((item) => item.id === temporaryId
                ? { ...item, deliveryStatus: "failed" }
                : item));
            setError(sendError instanceof Error ? sendError.message : "Gagal mengirim balasan");
        } finally {
            setSending(false);
        }
    };

    const retryMessage = async (messageId: string) => {
        if (!selectedUser || messageId.startsWith("temporary:")) return;
        setError(null);
        setMessages((current) => current.map((item) => item.id === messageId
            ? { ...item, deliveryStatus: "queued" }
            : item));
        try {
            const response = await fetch(
                `/api/conversations/${encodeURIComponent(selectedUser.id)}/messages/${encodeURIComponent(messageId)}/retry`,
                { method: "POST" }
            );
            const payload = await response.json() as ApiEnvelope;
            if (!response.ok || !payload.success) throw new Error(readApiMessage(payload, "Gagal mencoba ulang pesan"));
            await fetchLatest();
        } catch (retryError) {
            setMessages((current) => current.map((item) => item.id === messageId
                ? { ...item, deliveryStatus: "failed" }
                : item));
            setError(retryError instanceof Error ? retryError.message : "Gagal mencoba ulang pesan");
        }
    };

    const resolveHandover = async () => {
        if (!selectedUser || resolvingHandover) return;
        setResolvingHandover(true);
        setError(null);
        try {
            const response = await fetch(
                `/api/conversations/${encodeURIComponent(selectedUser.id)}/handover/resolve`,
                { method: "POST" }
            );
            const payload = await response.json() as ApiEnvelope;
            if (!response.ok || !payload.success) throw new Error(readApiMessage(payload, "Gagal menyelesaikan handover"));
            setHandoverPending(false);
        } catch (resolveError) {
            setError(resolveError instanceof Error ? resolveError.message : "Gagal menyelesaikan handover");
        } finally {
            setResolvingHandover(false);
        }
    };

    const connected = connectionStatus === "open";
    const composerDisabled = !canWrite || !channel.isEnabled || !connected || !selectedUser;

    return (
        <div className="grid min-h-[640px] overflow-hidden rounded-lg border border-slate-200 bg-white lg:grid-cols-[320px,1fr]">
            <aside className="border-b border-slate-200 lg:border-b-0 lg:border-r">
                <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
                    Percakapan WhatsApp ({users.length})
                </div>
                <div className="max-h-[72vh] overflow-auto">
                    {users.length === 0 ? (
                        <p className="p-4 text-sm text-slate-500">Tidak ada percakapan pada channel ini.</p>
                    ) : users.map((user) => (
                        <Link
                            key={user.id}
                            href={user.href}
                            className={`block border-b border-slate-100 px-4 py-3 ${selectedUser?.id === user.id ? "bg-slate-100" : "hover:bg-slate-50"}`}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <p className="truncate text-sm font-semibold text-slate-800">{user.name}</p>
                                {user.lastMessageAt ? (
                                    <time className="shrink-0 text-[10px] text-slate-400">
                                        {new Date(user.lastMessageAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                                    </time>
                                ) : null}
                            </div>
                            <p className="truncate text-xs text-slate-500">{user.phoneNumber}</p>
                            <p className="mt-1 truncate text-xs text-slate-600">{user.lastMessage || "Belum ada pesan"}</p>
                        </Link>
                    ))}
                </div>
            </aside>

            <section className="flex min-w-0 flex-col">
                <header className="flex min-h-16 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{selectedUser?.name || "Pilih percakapan"}</p>
                        <p className="truncate text-xs text-slate-500">{selectedUser?.phoneNumber || channel.name}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {handoverPending ? (
                            <button
                                type="button"
                                title="Kembalikan percakapan ke AI"
                                onClick={() => void resolveHandover()}
                                disabled={!canWrite || resolvingHandover}
                                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                            >
                                {resolvingHandover
                                    ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                    : <UserRoundCheck className="h-3.5 w-3.5" />}
                                Selesaikan handover
                            </button>
                        ) : null}
                        <span className={`inline-flex items-center gap-1 text-xs ${connected ? "text-emerald-700" : "text-rose-700"}`}>
                            {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                            {connectionStatus === "connecting" ? "Menghubungkan" : connected ? "Terhubung" : "Terputus"}
                        </span>
                    </div>
                </header>

                <div className="flex-1 overflow-auto bg-slate-50/60 p-4">
                    {nextCursor ? (
                        <div className="mb-4 text-center">
                            <button
                                type="button"
                                onClick={() => void loadOlder()}
                                disabled={loadingOlder}
                                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                                {loadingOlder ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                Muat pesan lama
                            </button>
                        </div>
                    ) : null}

                    {messages.length === 0 ? (
                        <p className="py-12 text-center text-sm text-slate-500">Belum ada pesan.</p>
                    ) : (
                        <div className="space-y-3">
                            {messages.map((message) => {
                                const outbound = message.role !== "user";
                                return (
                                    <div key={message.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                                        <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${outbound ? "bg-emerald-100 text-emerald-950" : "bg-white text-slate-900"}`}>
                                            {message.content && !/^\[(Document|Audio|Sticker)\]$/.test(message.content) ? (
                                                <p className="whitespace-pre-wrap break-words">{message.content}</p>
                                            ) : null}
                                            {message.attachments.map((attachment) => (
                                                <Attachment key={attachment.id} attachment={attachment} />
                                            ))}
                                            <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-65">
                                                <time>{new Date(message.createdAt).toLocaleString("id-ID", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</time>
                                                {outbound ? deliveryIcon(message.deliveryStatus) : null}
                                            </div>
                                            {outbound && message.deliveryStatus === "failed" && !message.id.startsWith("temporary:") ? (
                                                <button
                                                    type="button"
                                                    onClick={() => void retryMessage(message.id)}
                                                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-rose-700 hover:text-rose-900"
                                                >
                                                    <RefreshCw className="h-3.5 w-3.5" />
                                                    Coba lagi
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <div ref={messageEndRef} />
                </div>

                <footer className="border-t border-slate-200 bg-white p-3">
                    {error ? <p className="mb-2 text-xs text-rose-700">{error}</p> : null}
                    <div className="flex items-end gap-2">
                        <textarea
                            value={text}
                            onChange={(event) => setText(event.target.value.slice(0, 4096))}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    void sendReply();
                                }
                            }}
                            disabled={composerDisabled || sending}
                            rows={2}
                            placeholder={canWrite ? "Tulis balasan..." : "Akses hanya baca"}
                            className="min-h-11 flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 disabled:bg-slate-100"
                        />
                        <button
                            type="button"
                            title="Kirim balasan"
                            aria-label="Kirim balasan"
                            onClick={() => void sendReply()}
                            disabled={composerDisabled || sending || !text.trim()}
                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-emerald-700 text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </button>
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                        <span>{composerDisabled && canWrite ? "Channel harus terhubung untuk membalas" : ""}</span>
                        <span>{text.length}/4096</span>
                    </div>
                </footer>
            </section>
        </div>
    );
}
