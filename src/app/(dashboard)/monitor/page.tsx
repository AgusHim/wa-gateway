"use client";

import { useEffect, useMemo, useState } from "react";

type MonitorMessage = {
    phoneNumber: string;
    messageText: string;
    messageId: string;
    pushName?: string;
    timestamp: number;
};

export default function MonitorPage() {
    const [messages, setMessages] = useState<MonitorMessage[]>([]);
    const [phoneFilter, setPhoneFilter] = useState("");
    const [userFilter, setUserFilter] = useState("");
    const [connectionState, setConnectionState] = useState<"connected" | "disconnected">("disconnected");

    useEffect(() => {
        const source = new EventSource("/api/sse");

        source.addEventListener("connected", () => {
            setConnectionState("connected");
        });

        source.addEventListener("new-message", (event) => {
            const payload = JSON.parse(event.data) as MonitorMessage;
            setMessages((prev) => [payload, ...prev].slice(0, 200));
        });

        source.onerror = () => {
            setConnectionState("disconnected");
        };

        return () => {
            source.close();
        };
    }, []);

    const filteredMessages = useMemo(() => {
        const phone = phoneFilter.trim().toLowerCase();
        const user = userFilter.trim().toLowerCase();

        return messages.filter((msg) => {
            const phoneMatch = !phone || msg.phoneNumber.toLowerCase().includes(phone);
            const userMatch = !user || (msg.pushName || "").toLowerCase().includes(user);
            return phoneMatch && userMatch;
        });
    }, [messages, phoneFilter, userFilter]);

    return (
        <section className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold text-slate-900">Live Monitor</h1>
                    <p className="text-sm text-slate-500">Stream pesan masuk secara real-time dari WhatsApp.</p>
                </div>

                <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                        connectionState === "connected"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-rose-100 text-rose-700"
                    }`}
                >
                    SSE: {connectionState}
                </span>
            </div>

            <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
                <input
                    type="text"
                    placeholder="Filter by phoneNumber"
                    value={phoneFilter}
                    onChange={(e) => setPhoneFilter(e.target.value)}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
                <input
                    type="text"
                    placeholder="Filter by user (pushName)"
                    value={userFilter}
                    onChange={(e) => setUserFilter(e.target.value)}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
            </div>

            <div className="space-y-3">
                {filteredMessages.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                        Belum ada pesan yang cocok dengan filter.
                    </p>
                ) : (
                    filteredMessages.map((msg) => (
                        <article key={`${msg.messageId}-${msg.timestamp}`} className="rounded-lg border border-slate-200 bg-white p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                                <span>{msg.pushName || "Unknown User"}</span>
                                <span>{new Date(msg.timestamp * 1000).toLocaleString("id-ID")}</span>
                            </div>
                            <p className="mt-1 text-sm font-medium text-slate-700">{msg.phoneNumber}</p>
                            <p className="mt-3 text-sm text-slate-900">{msg.messageText}</p>
                        </article>
                    ))
                )}
            </div>
        </section>
    );
}
