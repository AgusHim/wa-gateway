"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function ResetPasswordContent() {
    const searchParams = useSearchParams();
    const token = searchParams.get("token") || "";

    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
    const [message, setMessage] = useState("");

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();

        if (!token) {
            setStatus("error");
            setMessage("Token reset password tidak ditemukan.");
            return;
        }

        setIsLoading(true);
        setStatus("idle");
        setMessage("");

        try {
            const response = await fetch("/api/auth/password-reset/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, password }),
            });
            const payload = await response.json() as { success?: boolean; message?: string };

            if (!response.ok || !payload.success) {
                setStatus("error");
                setMessage(payload.message || "Reset password gagal");
                return;
            }

            setStatus("success");
            setMessage(payload.message || "Password berhasil diperbarui");
            setPassword("");
        } catch {
            setStatus("error");
            setMessage("Gagal reset password");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">Reset Password</h1>
            <p className="mt-1 text-sm text-slate-500">Masukkan password baru untuk akun tenant Anda.</p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4">
                <div>
                    <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
                        Password Baru
                    </label>
                    <input
                        id="password"
                        type="password"
                        minLength={8}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        required
                    />
                </div>

                <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {isLoading ? "Memproses..." : "Update Password"}
                </button>
            </form>

            {status === "success" ? (
                <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>
            ) : null}
            {status === "error" ? (
                <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</p>
            ) : null}

            <p className="mt-4 text-sm text-slate-600">
                <Link href="/login" className="font-medium text-slate-900 underline">Kembali ke Login</Link>
            </p>
        </div>
    );
}

export default function ResetPasswordPage() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
            <Suspense fallback={<div className="text-sm text-slate-500">Memuat...</div>}>
                <ResetPasswordContent />
            </Suspense>
        </div>
    );
}
