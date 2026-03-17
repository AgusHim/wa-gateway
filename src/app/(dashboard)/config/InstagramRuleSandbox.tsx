"use client";

import { FormEvent, useState } from "react";

type PreviewResponse = {
    success?: boolean;
    message?: string;
    data?: {
        eventType?: string;
        evaluation?: {
            allowed?: boolean;
            reason?: string;
            matchedKeywords?: string[];
            sentimentScore?: number;
            fallbackMessage?: string;
        };
    };
};

export function InstagramRuleSandbox() {
    const [eventType, setEventType] = useState<"instagram-dm" | "instagram-comment">("instagram-dm");
    const [messageText, setMessageText] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<PreviewResponse["data"] | null>(null);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setIsLoading(true);
        setError(null);
        setResult(null);

        try {
            const response = await fetch("/api/instagram/rules/preview", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    eventType,
                    messageText,
                }),
            });

            const payload = await response.json() as PreviewResponse;
            if (!response.ok || payload.success !== true) {
                throw new Error(payload.message || "Sandbox preview gagal");
            }

            setResult(payload.data || null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Sandbox preview gagal");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">Instagram Rule Sandbox</h2>
            <p className="mt-1 text-sm text-slate-500">
                Simulasikan event DM/Comment untuk melihat apakah auto-reply akan dijalankan berdasarkan rule saat ini.
            </p>

            <form onSubmit={submit} className="mt-4 space-y-3">
                <div className="grid gap-3 md:grid-cols-3">
                    <label className="space-y-1 md:col-span-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-600">Event Type</span>
                        <select
                            value={eventType}
                            onChange={(e) => setEventType(e.target.value === "instagram-comment" ? "instagram-comment" : "instagram-dm")}
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                            <option value="instagram-dm">Instagram DM</option>
                            <option value="instagram-comment">Instagram Comment</option>
                        </select>
                    </label>

                    <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-600">Message Text</span>
                        <input
                            value={messageText}
                            onChange={(e) => setMessageText(e.target.value)}
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Contoh: Kak ini produknya bagus banget"
                            required
                        />
                    </label>
                </div>

                <button
                    type="submit"
                    disabled={isLoading}
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {isLoading ? "Testing..." : "Test Rule"}
                </button>
            </form>

            {error ? (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                </div>
            ) : null}

            {result?.evaluation ? (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <p>
                        Decision: <span className="font-semibold">{result.evaluation.allowed ? "ALLOW" : "BLOCK"}</span>
                    </p>
                    <p>Reason: {result.evaluation.reason || "-"}</p>
                    <p>Sentiment Score: {typeof result.evaluation.sentimentScore === "number" ? result.evaluation.sentimentScore.toFixed(2) : "0.00"}</p>
                    <p>
                        Matched Keywords: {(result.evaluation.matchedKeywords || []).length > 0
                            ? (result.evaluation.matchedKeywords || []).join(", ")
                            : "-"}
                    </p>
                    {result.evaluation.fallbackMessage ? (
                        <p>Fallback Message: {result.evaluation.fallbackMessage}</p>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
