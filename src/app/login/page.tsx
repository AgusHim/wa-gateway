"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { getProviders, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [hasGoogleProvider, setHasGoogleProvider] = useState(false);

    const callbackUrl = searchParams.get("callbackUrl") || "/";

    useEffect(() => {
        const loadProviders = async () => {
            const providers = await getProviders();
            setHasGoogleProvider(Boolean(providers?.google));
        };

        void loadProviders();
    }, []);

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setError("");
        setIsLoading(true);

        const result = await signIn("credentials", {
            email,
            password,
            redirect: false,
            callbackUrl,
        });

        setIsLoading(false);

        if (!result || result.error) {
            setError("Email atau password tidak valid.");
            return;
        }

        router.push(result.url || callbackUrl);
        router.refresh();
    };

    return (
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">Login Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">Masuk sebagai admin untuk mengelola WA Gateway.</p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4">
                <div>
                    <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
                        Email
                    </label>
                    <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                        required
                    />
                </div>

                <div>
                    <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
                        Password
                    </label>
                    <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                        required
                    />
                </div>

                {error ? (
                    <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
                ) : null}

                <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {isLoading ? "Memproses..." : "Masuk"}
                </button>

                {hasGoogleProvider ? (
                    <button
                        type="button"
                        onClick={() => void signIn("google", { callbackUrl })}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                        Masuk dengan Google
                    </button>
                ) : null}
            </form>

            <div className="mt-4 space-y-1 text-sm text-slate-600">
                <p>
                    Belum punya tenant?{" "}
                    <Link href="/signup" className="font-medium text-slate-900 underline">
                        Buat Organization
                    </Link>
                </p>
                <p>
                    Lupa password?{" "}
                    <Link href="/forgot-password" className="font-medium text-slate-900 underline">
                        Reset password
                    </Link>
                </p>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
            <Suspense fallback={<div className="text-sm text-slate-500">Memuat...</div>}>
                <LoginForm />
            </Suspense>
        </div>
    );
}
