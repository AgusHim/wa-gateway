"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function VerifyEmailContent() {
    const searchParams = useSearchParams();
    const token = searchParams.get("token") || "";

    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
    const [message, setMessage] = useState("");

    const verify = async () => {
        if (!token) {
            setStatus("error");
            setMessage("Token verifikasi tidak ditemukan.");
            return;
        }

        setIsLoading(true);
        setStatus("idle");

        try {
            const response = await fetch("/api/auth/verify-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token }),
            });
            const payload = await response.json() as { success?: boolean; message?: string };

            if (!response.ok || !payload.success) {
                setStatus("error");
                setMessage(payload.message || "Verifikasi gagal");
                return;
            }

            setStatus("success");
            setMessage(payload.message || "Email berhasil diverifikasi");
        } catch {
            setStatus("error");
            setMessage("Gagal memverifikasi email");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (token) {
            void verify();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    return (
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">Verifikasi Email</h1>
            <p className="mt-1 text-sm text-slate-500">Aktivasi akun tenant sebelum login.</p>

            <button
                type="button"
                onClick={() => void verify()}
                disabled={isLoading}
                className="mt-6 w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
                {isLoading ? "Memproses..." : "Verifikasi Sekarang"}
            </button>

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

export default function VerifyEmailPage() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
            <Suspense fallback={<div className="text-sm text-slate-500">Memuat...</div>}>
                <VerifyEmailContent />
            </Suspense>
        </div>
    );
}
