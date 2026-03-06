"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [resetPreview, setResetPreview] = useState("");

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setIsLoading(true);
        setMessage("");
        setResetPreview("");

        try {
            const response = await fetch("/api/auth/password-reset/request", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });
            const payload = await response.json() as {
                message?: string;
                data?: { resetLinkPreview?: string };
            };
            setMessage(payload.message || "Permintaan reset password diproses.");
            setResetPreview(payload.data?.resetLinkPreview || "");
        } catch {
            setMessage("Gagal memproses permintaan reset password");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
            <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h1 className="text-xl font-semibold text-slate-900">Lupa Password</h1>
                <p className="mt-1 text-sm text-slate-500">Masukkan email akun Anda untuk menerima link reset password.</p>

                <form onSubmit={onSubmit} className="mt-6 space-y-4">
                    <div>
                        <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
                            Email
                        </label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isLoading ? "Memproses..." : "Kirim Link Reset"}
                    </button>
                </form>

                {message ? (
                    <div className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        <p>{message}</p>
                        {resetPreview ? (
                            <p className="mt-1 break-all text-xs">
                                Preview link: <a href={resetPreview} className="underline">{resetPreview}</a>
                            </p>
                        ) : null}
                    </div>
                ) : null}

                <p className="mt-4 text-sm text-slate-600">
                    <Link href="/login" className="font-medium text-slate-900 underline">Kembali ke Login</Link>
                </p>
            </div>
        </div>
    );
}
