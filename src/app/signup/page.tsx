"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function SignupPage() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [organizationName, setOrganizationName] = useState("");
    const [workspaceName, setWorkspaceName] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [verificationPreview, setVerificationPreview] = useState("");

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setError("");
        setSuccess("");
        setVerificationPreview("");
        setIsLoading(true);

        try {
            const response = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name,
                    email,
                    password,
                    organizationName,
                    workspaceName,
                }),
            });
            const payload = await response.json() as {
                success?: boolean;
                message?: string;
                data?: { verificationLinkPreview?: string };
            };

            if (!response.ok || !payload.success) {
                setError(payload.message || "Registrasi gagal");
                return;
            }

            setSuccess(payload.message || "Registrasi berhasil");
            setVerificationPreview(payload.data?.verificationLinkPreview || "");
        } catch {
            setError("Gagal memproses registrasi");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8">
            <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h1 className="text-xl font-semibold text-slate-900">Buat Organization Pertama</h1>
                <p className="mt-1 text-sm text-slate-500">Onboarding tenant owner untuk WA Gateway SaaS.</p>

                <form onSubmit={onSubmit} className="mt-6 grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                        <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">
                            Nama
                        </label>
                        <input
                            id="name"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            required
                        />
                    </div>

                    <div className="md:col-span-2">
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

                    <div className="md:col-span-2">
                        <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            minLength={8}
                            required
                        />
                    </div>

                    <div>
                        <label htmlFor="organizationName" className="mb-1 block text-sm font-medium text-slate-700">
                            Organization
                        </label>
                        <input
                            id="organizationName"
                            value={organizationName}
                            onChange={(event) => setOrganizationName(event.target.value)}
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            required
                        />
                    </div>

                    <div>
                        <label htmlFor="workspaceName" className="mb-1 block text-sm font-medium text-slate-700">
                            Workspace
                        </label>
                        <input
                            id="workspaceName"
                            value={workspaceName}
                            onChange={(event) => setWorkspaceName(event.target.value)}
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            required
                        />
                    </div>

                    {error ? (
                        <p className="md:col-span-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
                    ) : null}

                    {success ? (
                        <div className="md:col-span-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                            <p>{success}</p>
                            {verificationPreview ? (
                                <p className="mt-1 break-all text-xs">
                                    Preview link: <a href={verificationPreview} className="underline">{verificationPreview}</a>
                                </p>
                            ) : null}
                        </div>
                    ) : null}

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="md:col-span-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isLoading ? "Memproses..." : "Buat Tenant"}
                    </button>
                </form>

                <p className="mt-4 text-sm text-slate-600">
                    Sudah punya akun? <Link href="/login" className="font-medium text-slate-900 underline">Masuk</Link>
                </p>
            </div>
        </div>
    );
}
