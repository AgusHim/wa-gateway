"use client";

import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
    parseConnectionUpdatePayload,
    parseQrPayload,
    type WAConnectionStatus,
} from "@/types/dashboard";

type ChannelPolicy = {
    allowlist: string[];
    denylist: string[];
    allowedCountryPrefixes: string[];
    requireTemplateForBroadcast: boolean;
    allowedTemplatePrefixes: string[];
};

type ChannelRuntime = {
    channelId: string;
    workspaceId?: string;
    name: string;
    provider: string;
    identifier?: string | null;
    status: WAConnectionStatus;
    isEnabled: boolean;
    isPrimary: boolean;
    healthStatus: string;
    healthScore: number;
    rateLimitPerSecond: number;
    qrExpiresAt?: number | null;
    policy?: unknown;
    lastError?: string | null;
};

type ChannelAudit = {
    id: string;
    eventType: string;
    status: string;
    message?: string | null;
    createdAt: string;
};

type ChannelFormState = {
    provider: "whatsapp" | "instagram";
    name: string;
    identifier: string;
    rateLimitPerSecond: string;
    isPrimary: boolean;
    isEnabled: boolean;
    allowlist: string;
    denylist: string;
    allowedCountryPrefixes: string;
    requireTemplateForBroadcast: boolean;
    allowedTemplatePrefixes: string;
};

const EMPTY_FORM: ChannelFormState = {
    provider: "whatsapp",
    name: "",
    identifier: "",
    rateLimitPerSecond: "5",
    isPrimary: false,
    isEnabled: true,
    allowlist: "",
    denylist: "",
    allowedCountryPrefixes: "",
    requireTemplateForBroadcast: false,
    allowedTemplatePrefixes: "",
};

function parseCommaList(value: string): string[] {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function toCommaList(value: string[] | undefined): string {
    if (!value || value.length === 0) return "";
    return value.join(", ");
}

function readPolicy(value: unknown): ChannelPolicy {
    const source = (typeof value === "object" && value !== null) ? value as Record<string, unknown> : {};

    const readList = (field: unknown): string[] => {
        if (!Array.isArray(field)) return [];
        return field.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
    };

    return {
        allowlist: readList(source.allowlist),
        denylist: readList(source.denylist),
        allowedCountryPrefixes: readList(source.allowedCountryPrefixes),
        requireTemplateForBroadcast: source.requireTemplateForBroadcast === true,
        allowedTemplatePrefixes: readList(source.allowedTemplatePrefixes),
    };
}

function toFormState(channel: ChannelRuntime): ChannelFormState {
    const policy = readPolicy(channel.policy);

    return {
        provider: channel.provider === "instagram" ? "instagram" : "whatsapp",
        name: channel.name,
        identifier: channel.identifier || "",
        rateLimitPerSecond: String(channel.rateLimitPerSecond || 5),
        isPrimary: channel.isPrimary,
        isEnabled: channel.isEnabled,
        allowlist: toCommaList(policy.allowlist),
        denylist: toCommaList(policy.denylist),
        allowedCountryPrefixes: toCommaList(policy.allowedCountryPrefixes),
        requireTemplateForBroadcast: policy.requireTemplateForBroadcast,
        allowedTemplatePrefixes: toCommaList(policy.allowedTemplatePrefixes),
    };
}

function connectionText(status: WAConnectionStatus): string {
    if (status === "open") return "Connected";
    if (status === "connecting") return "Connecting";
    return "Disconnected";
}

function healthText(status: string): string {
    const normalized = status.toLowerCase();
    if (normalized === "connected") return "Connected";
    if (normalized === "degraded") return "Degraded";
    if (normalized === "banned-risk" || normalized === "banned_risk") return "Banned Risk";
    return "Disconnected";
}

async function parseJsonResponse<T = unknown>(response: Response): Promise<T> {
    try {
        return await response.json() as T;
    } catch {
        return {} as T;
    }
}

function FormField({
    label,
    helper,
    children,
}: {
    label: string;
    helper: string;
    children: ReactNode;
}) {
    return (
        <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p>
            {children}
            <p className="text-xs text-slate-500">{helper}</p>
        </div>
    );
}

function ToggleField({
    id,
    label,
    helper,
    checked,
    onChange,
}: {
    id: string;
    label: string;
    helper: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => onChange(event.target.checked)}
                />
                {label}
            </label>
            <p className="mt-1 text-xs text-slate-500">{helper}</p>
        </div>
    );
}

export default function ChannelsPage() {
    const [channels, setChannels] = useState<ChannelRuntime[]>([]);
    const [audits, setAudits] = useState<ChannelAudit[]>([]);
    const [selectedChannelId, setSelectedChannelId] = useState("");
    const [createForm, setCreateForm] = useState<ChannelFormState>(EMPTY_FORM);
    const [editForm, setEditForm] = useState<ChannelFormState>(EMPTY_FORM);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [qrByChannel, setQrByChannel] = useState<Record<string, string>>({});

    const selectedChannel = useMemo(
        () => channels.find((channel) => channel.channelId === selectedChannelId) ?? channels[0] ?? null,
        [channels, selectedChannelId]
    );
    const isWhatsAppSelected = selectedChannel?.provider === "whatsapp";
    const selectedQr = selectedChannel ? qrByChannel[selectedChannel.channelId] || "" : "";

    const refreshChannels = async (keepMessage = false) => {
        if (!keepMessage) {
            setMessage(null);
        }
        setError(null);

        const response = await fetch("/api/wa/channels", { cache: "no-store" });
        const payload = await parseJsonResponse<{ success?: boolean; message?: string; data?: { channels?: ChannelRuntime[] } }>(response);

        if (!response.ok || payload.success !== true) {
            throw new Error(payload.message || "Gagal memuat channel");
        }

        const nextChannels = Array.isArray(payload.data?.channels) ? payload.data.channels : [];
        setChannels(nextChannels);
        setSelectedChannelId((current) => {
            if (current && nextChannels.some((item) => item.channelId === current)) {
                return current;
            }
            return nextChannels[0]?.channelId || "";
        });
    };

    useEffect(() => {
        let active = true;

        const run = async () => {
            setIsLoading(true);
            try {
                await refreshChannels();
            } catch (err) {
                if (active) {
                    setError(err instanceof Error ? err.message : "Gagal memuat channel");
                }
            } finally {
                if (active) {
                    setIsLoading(false);
                }
            }
        };

        void run();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!selectedChannel) {
            setEditForm(EMPTY_FORM);
            setAudits([]);
            return;
        }

        setEditForm(toFormState(selectedChannel));

        let active = true;
        const loadAudits = async () => {
            try {
                const response = await fetch(`/api/wa/channels/${selectedChannel.channelId}/audits?limit=20`, {
                    cache: "no-store",
                });
                const payload = await parseJsonResponse<{
                    success?: boolean;
                    data?: { audits?: ChannelAudit[] };
                }>(response);

                if (!active) return;
                if (!response.ok || payload.success !== true) {
                    setAudits([]);
                    return;
                }

                setAudits(Array.isArray(payload.data?.audits) ? payload.data.audits : []);
            } catch {
                if (active) {
                    setAudits([]);
                }
            }
        };

        void loadAudits();

        return () => {
            active = false;
        };
    }, [selectedChannel]);

    useEffect(() => {
        const source = new EventSource("/api/sse");

        source.addEventListener("qr", (event) => {
            if (!(event instanceof MessageEvent)) return;
            try {
                const payload = parseQrPayload(JSON.parse(event.data));
                if (!payload?.channelId || !payload.qr) {
                    return;
                }

                setQrByChannel((prev) => ({
                    ...prev,
                    [payload.channelId as string]: payload.qr,
                }));
            } catch {
                return;
            }
        });

        source.addEventListener("connection-update", (event) => {
            if (!(event instanceof MessageEvent)) return;
            try {
                const payload = parseConnectionUpdatePayload(JSON.parse(event.data));
                if (!payload?.channelId) {
                    return;
                }

                setChannels((prev) => prev.map((channel) => {
                    if (channel.channelId !== payload.channelId) {
                        return channel;
                    }

                    return {
                        ...channel,
                        status: payload.status,
                        healthStatus: payload.healthStatus || channel.healthStatus,
                        lastError: payload.message || channel.lastError || null,
                    };
                }));

                if (payload.status === "open") {
                    setQrByChannel((prev) => {
                        if (!prev[payload.channelId as string]) {
                            return prev;
                        }
                        const next = { ...prev };
                        delete next[payload.channelId as string];
                        return next;
                    });
                }
            } catch {
                return;
            }
        });

        return () => {
            source.close();
        };
    }, []);

    const buildPolicyPayload = (form: ChannelFormState) => ({
        allowlist: parseCommaList(form.allowlist),
        denylist: parseCommaList(form.denylist),
        allowedCountryPrefixes: parseCommaList(form.allowedCountryPrefixes),
        requireTemplateForBroadcast: form.requireTemplateForBroadcast,
        allowedTemplatePrefixes: parseCommaList(form.allowedTemplatePrefixes),
    });

    const createChannel = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setIsSubmitting(true);
        setMessage(null);
        setError(null);

        try {
            const payload = {
                provider: createForm.provider,
                name: createForm.name,
                identifier: createForm.identifier || undefined,
                isPrimary: createForm.isPrimary,
                rateLimitPerSecond: Number(createForm.rateLimitPerSecond || "5"),
                autoConnect: createForm.provider === "whatsapp",
                ...buildPolicyPayload(createForm),
            };

            const response = await fetch("/api/wa/channels", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            const body = await parseJsonResponse<{ success?: boolean; message?: string }>(response);
            if (!response.ok || body.success !== true) {
                throw new Error(body.message || "Gagal membuat channel");
            }

            await refreshChannels(true);
            setCreateForm(EMPTY_FORM);
            setMessage("Channel berhasil dibuat.");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Gagal membuat channel");
        } finally {
            setIsSubmitting(false);
        }
    };

    const saveChannel = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!selectedChannel) return;

        setIsSubmitting(true);
        setMessage(null);
        setError(null);

        try {
            const response = await fetch(`/api/wa/channels/${selectedChannel.channelId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    name: editForm.name,
                    identifier: editForm.identifier || null,
                    isEnabled: editForm.isEnabled,
                    isPrimary: editForm.isPrimary,
                    rateLimitPerSecond: Number(editForm.rateLimitPerSecond || "5"),
                    policy: buildPolicyPayload(editForm),
                }),
            });

            const body = await parseJsonResponse<{ success?: boolean; message?: string }>(response);
            if (!response.ok || body.success !== true) {
                throw new Error(body.message || "Gagal memperbarui channel");
            }

            await refreshChannels(true);
            setMessage("Perubahan channel tersimpan.");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Gagal memperbarui channel");
        } finally {
            setIsSubmitting(false);
        }
    };

    const runChannelAction = async (
        action: "connect" | "disconnect" | "reset" | "remove"
    ) => {
        if (!selectedChannel) return;

        setIsSubmitting(true);
        setMessage(null);
        setError(null);

        try {
            if (action === "remove") {
                setQrByChannel((prev) => {
                    if (!prev[selectedChannel.channelId]) {
                        return prev;
                    }
                    const next = { ...prev };
                    delete next[selectedChannel.channelId];
                    return next;
                });

                const response = await fetch(`/api/wa/channels/${selectedChannel.channelId}`, {
                    method: "DELETE",
                });
                const body = await parseJsonResponse<{ success?: boolean; message?: string }>(response);
                if (!response.ok || body.success !== true) {
                    throw new Error(body.message || "Gagal menghapus channel");
                }
                await refreshChannels(true);
                setMessage("Channel dihapus.");
                return;
            }

            if (action === "disconnect" || action === "reset") {
                setQrByChannel((prev) => {
                    if (!prev[selectedChannel.channelId]) {
                        return prev;
                    }
                    const next = { ...prev };
                    delete next[selectedChannel.channelId];
                    return next;
                });
            }

            const response = await fetch(`/api/wa/channels/${selectedChannel.channelId}/${action}`, {
                method: "POST",
            });
            const body = await parseJsonResponse<{ success?: boolean; message?: string }>(response);
            if (!response.ok || body.success !== true) {
                throw new Error(body.message || `Gagal menjalankan aksi ${action}`);
            }

            await refreshChannels(true);
            setMessage(`Aksi ${action} berhasil dijalankan.`);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Aksi channel gagal");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <section className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Channels</h1>
                <p className="text-sm text-slate-500">
                    Tambah/hapus channel WhatsApp, atur policy nomor tujuan, dan kelola lifecycle koneksi.
                </p>
            </div>

            {message ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    {message}
                </div>
            ) : null}
            {error ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    {error}
                </div>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-2">
                <form onSubmit={createChannel} className="rounded-lg border border-slate-200 bg-white p-4">
                    <h2 className="text-base font-semibold text-slate-900">Tambah Channel</h2>
                    <div className="mt-3 grid gap-4">
                        <FormField
                            label="Provider"
                            helper="Pilih channel provider. WhatsApp akan auto connect, Instagram disiapkan untuk integrasi berikutnya."
                        >
                            <select
                                id="create-provider"
                                value={createForm.provider}
                                onChange={(event) => setCreateForm((prev) => ({
                                    ...prev,
                                    provider: event.target.value === "instagram" ? "instagram" : "whatsapp",
                                }))}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            >
                                <option value="whatsapp">WhatsApp</option>
                                <option value="instagram">Instagram</option>
                            </select>
                        </FormField>

                        <FormField
                            label="Nama Channel"
                            helper="Nama internal channel untuk membedakan akun WhatsApp di dashboard."
                        >
                            <input
                                id="create-name"
                                type="text"
                                placeholder="Contoh: CS Utama"
                                value={createForm.name}
                                onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                required
                            />
                        </FormField>

                        <FormField
                            label="Identifier (Opsional)"
                            helper="Nomor/identifier akun WA, dipakai untuk identifikasi cepat di tabel channel."
                        >
                            <input
                                id="create-identifier"
                                type="text"
                                placeholder="Contoh: 6281234567890"
                                value={createForm.identifier}
                                onChange={(event) => setCreateForm((prev) => ({ ...prev, identifier: event.target.value }))}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            />
                        </FormField>

                        <FormField
                            label="Rate Limit per Detik"
                            helper="Batas maksimal pesan outbound per detik untuk channel ini."
                        >
                            <input
                                id="create-rate-limit"
                                type="number"
                                min={1}
                                max={100}
                                placeholder="5"
                                value={createForm.rateLimitPerSecond}
                                onChange={(event) => setCreateForm((prev) => ({ ...prev, rateLimitPerSecond: event.target.value }))}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            />
                        </FormField>

                        <ToggleField
                            id="create-is-primary"
                            label="Set sebagai Primary Channel"
                            helper="Jika aktif, channel ini menjadi default untuk alur outbound workspace."
                            checked={createForm.isPrimary}
                            onChange={(value) => setCreateForm((prev) => ({ ...prev, isPrimary: value }))}
                        />

                        <FormField
                            label="Allowlist Nomor"
                            helper="Hanya nomor di daftar ini yang diizinkan menerima outbound. Pisahkan dengan koma."
                        >
                            <input
                                id="create-allowlist"
                                type="text"
                                placeholder="628111111111, 628222222222"
                                value={createForm.allowlist}
                                onChange={(event) => setCreateForm((prev) => ({ ...prev, allowlist: event.target.value }))}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            />
                        </FormField>

                        <FormField
                            label="Denylist Nomor"
                            helper="Nomor di daftar ini akan selalu diblokir untuk outbound. Pisahkan dengan koma."
                        >
                            <input
                                id="create-denylist"
                                type="text"
                                placeholder="628333333333, 628444444444"
                                value={createForm.denylist}
                                onChange={(event) => setCreateForm((prev) => ({ ...prev, denylist: event.target.value }))}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            />
                        </FormField>

                        <FormField
                            label="Allowed Country Prefixes"
                            helper="Batasi negara tujuan berdasarkan prefix nomor telepon. Pisahkan dengan koma."
                        >
                            <input
                                id="create-country-prefixes"
                                type="text"
                                placeholder="62, 65"
                                value={createForm.allowedCountryPrefixes}
                                onChange={(event) => setCreateForm((prev) => ({ ...prev, allowedCountryPrefixes: event.target.value }))}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            />
                        </FormField>

                        <FormField
                            label="Allowed Template Prefixes"
                            helper="Batasi template broadcast/notification berdasarkan prefix nama template. Pisahkan dengan koma."
                        >
                            <input
                                id="create-template-prefixes"
                                type="text"
                                placeholder="promo_, notif_"
                                value={createForm.allowedTemplatePrefixes}
                                onChange={(event) => setCreateForm((prev) => ({ ...prev, allowedTemplatePrefixes: event.target.value }))}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            />
                        </FormField>

                        <ToggleField
                            id="create-require-template"
                            label="Wajib Template untuk Broadcast/Notification"
                            helper="Jika aktif, pesan mode broadcast/notification harus memakai template yang diizinkan."
                            checked={createForm.requireTemplateForBroadcast}
                            onChange={(value) => setCreateForm((prev) => ({
                                ...prev,
                                requireTemplateForBroadcast: value,
                            }))}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="mt-4 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        Tambah Channel
                    </button>
                </form>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="text-base font-semibold text-slate-900">Daftar Channel</h2>
                        <button
                            type="button"
                            onClick={() => void refreshChannels(true)}
                            className="rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-700"
                        >
                            Refresh
                        </button>
                    </div>

                    {isLoading ? (
                        <p className="mt-3 text-sm text-slate-500">Memuat channel...</p>
                    ) : channels.length === 0 ? (
                        <p className="mt-3 text-sm text-slate-500">Belum ada channel.</p>
                    ) : (
                        <div className="mt-3 overflow-hidden rounded border border-slate-200">
                            <table className="min-w-full divide-y divide-slate-200 text-sm">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                                        <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                                        <th className="px-3 py-2 text-left font-medium text-slate-600">Health</th>
                                        <th className="px-3 py-2 text-left font-medium text-slate-600">Rate</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {channels.map((channel) => {
                                        const selected = selectedChannel?.channelId === channel.channelId;
                                        return (
                                            <tr
                                                key={channel.channelId}
                                                className={selected ? "bg-slate-100" : "hover:bg-slate-50"}
                                            >
                                                <td className="px-3 py-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelectedChannelId(channel.channelId)}
                                                        className="text-left text-slate-800"
                                                    >
                                                        {channel.name} {channel.isPrimary ? "(Primary)" : ""}
                                                        <p className="text-xs text-slate-500">
                                                            {channel.provider} | {channel.identifier || "-"}
                                                        </p>
                                                    </button>
                                                </td>
                                                <td className="px-3 py-2 text-slate-700">{connectionText(channel.status)}</td>
                                                <td className="px-3 py-2 text-slate-700">{healthText(channel.healthStatus)}</td>
                                                <td className="px-3 py-2 text-slate-700">{channel.rateLimitPerSecond}/s</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {selectedChannel ? (
                <div className="grid gap-6 xl:grid-cols-2">
                    <form onSubmit={saveChannel} className="rounded-lg border border-slate-200 bg-white p-4">
                        <h2 className="text-base font-semibold text-slate-900">Edit Channel</h2>
                        <p className="mt-1 text-xs text-slate-500">{selectedChannel.channelId} | {selectedChannel.provider}</p>

                        <div className="mt-3 grid gap-4">
                            <FormField
                                label="Nama Channel"
                                helper="Nama internal channel untuk membedakan channel di dashboard."
                            >
                                <input
                                    id="edit-name"
                                    type="text"
                                    value={editForm.name}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                    required
                                />
                            </FormField>

                            <FormField
                                label="Identifier"
                                helper="Nomor/identifier akun WA untuk referensi cepat di daftar channel."
                            >
                                <input
                                    id="edit-identifier"
                                    type="text"
                                    value={editForm.identifier}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, identifier: event.target.value }))}
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                    placeholder="6281234567890"
                                />
                            </FormField>

                            <FormField
                                label="Rate Limit per Detik"
                                helper="Batas pesan outbound per detik untuk channel ini."
                            >
                                <input
                                    id="edit-rate-limit"
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={editForm.rateLimitPerSecond}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, rateLimitPerSecond: event.target.value }))}
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                />
                            </FormField>

                            <ToggleField
                                id="edit-is-enabled"
                                label="Channel Aktif"
                                helper="Jika nonaktif, channel tidak dipakai untuk proses runtime outbound/inbound."
                                checked={editForm.isEnabled}
                                onChange={(value) => setEditForm((prev) => ({ ...prev, isEnabled: value }))}
                            />

                            <ToggleField
                                id="edit-is-primary"
                                label="Primary Channel"
                                helper="Jika aktif, channel ini menjadi default untuk operasional outbound."
                                checked={editForm.isPrimary}
                                onChange={(value) => setEditForm((prev) => ({ ...prev, isPrimary: value }))}
                            />

                            <FormField
                                label="Allowlist Nomor"
                                helper="Hanya nomor pada daftar ini yang diizinkan menerima outbound. Pisahkan dengan koma."
                            >
                                <input
                                    id="edit-allowlist"
                                    type="text"
                                    placeholder="628111111111, 628222222222"
                                    value={editForm.allowlist}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, allowlist: event.target.value }))}
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                />
                            </FormField>

                            <FormField
                                label="Denylist Nomor"
                                helper="Nomor pada daftar ini selalu diblokir dari outbound. Pisahkan dengan koma."
                            >
                                <input
                                    id="edit-denylist"
                                    type="text"
                                    placeholder="628333333333, 628444444444"
                                    value={editForm.denylist}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, denylist: event.target.value }))}
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                />
                            </FormField>

                            <FormField
                                label="Allowed Country Prefixes"
                                helper="Batasi negara tujuan berdasarkan prefix nomor. Pisahkan dengan koma."
                            >
                                <input
                                    id="edit-country-prefixes"
                                    type="text"
                                    placeholder="62, 65"
                                    value={editForm.allowedCountryPrefixes}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, allowedCountryPrefixes: event.target.value }))}
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                />
                            </FormField>

                            <FormField
                                label="Allowed Template Prefixes"
                                helper="Batasi template berdasarkan prefix nama template. Pisahkan dengan koma."
                            >
                                <input
                                    id="edit-template-prefixes"
                                    type="text"
                                    placeholder="promo_, notif_"
                                    value={editForm.allowedTemplatePrefixes}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, allowedTemplatePrefixes: event.target.value }))}
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                />
                            </FormField>

                            <ToggleField
                                id="edit-require-template"
                                label="Wajib Template untuk Broadcast/Notification"
                                helper="Jika aktif, mode broadcast/notification wajib memakai template yang sesuai policy."
                                checked={editForm.requireTemplateForBroadcast}
                                onChange={(value) => setEditForm((prev) => ({
                                    ...prev,
                                    requireTemplateForBroadcast: value,
                                }))}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="mt-4 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            Simpan Perubahan
                        </button>
                    </form>

                    <div className="space-y-4">
                        <div className="rounded-lg border border-slate-200 bg-white p-4">
                            <h2 className="text-base font-semibold text-slate-900">QR Pairing</h2>
                            <p className="mt-1 text-xs text-slate-500">
                                {isWhatsAppSelected
                                    ? "Scan QR untuk menghubungkan akun WhatsApp ke channel ini."
                                    : "QR pairing hanya tersedia untuk provider WhatsApp."}
                            </p>

                            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                                <p>
                                    Status: <span className="font-semibold">{connectionText(selectedChannel.status)}</span>
                                </p>
                                <p>
                                    Health: <span className="font-semibold">{healthText(selectedChannel.healthStatus)}</span>
                                </p>
                                {selectedChannel.lastError ? (
                                    <p className="text-rose-700">Last Error: {selectedChannel.lastError}</p>
                                ) : null}
                                {selectedChannel.qrExpiresAt ? (
                                    <p>QR Expire: {new Date(selectedChannel.qrExpiresAt).toLocaleString("id-ID")}</p>
                                ) : null}
                            </div>

                            <div className="mt-3">
                                {selectedQr ? (
                                    <QRCodeSVG
                                        value={selectedQr}
                                        size={300}
                                        className="h-[300px] w-[300px] max-w-full rounded border border-slate-200 bg-white p-2"
                                    />
                                ) : (
                                    <div className="flex h-[300px] w-[300px] max-w-full items-center justify-center rounded border border-dashed border-slate-300 text-sm text-slate-500">
                                        {isWhatsAppSelected
                                            ? "Belum ada QR. Klik Connect atau Reset Session."
                                            : "Provider ini tidak memakai QR WhatsApp."}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white p-4">
                            <h2 className="text-base font-semibold text-slate-900">Lifecycle Actions</h2>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => void runChannelAction("connect")}
                                    disabled={isSubmitting || !isWhatsAppSelected}
                                    className="rounded-md border border-emerald-300 px-3 py-2 text-xs font-medium text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Connect
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void runChannelAction("disconnect")}
                                    disabled={isSubmitting || !isWhatsAppSelected}
                                    className="rounded-md border border-amber-300 px-3 py-2 text-xs font-medium text-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Disconnect
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void runChannelAction("reset")}
                                    disabled={isSubmitting || !isWhatsAppSelected}
                                    className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Reset Session
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void runChannelAction("remove")}
                                    disabled={isSubmitting}
                                    className="rounded-md bg-rose-600 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Remove Channel
                                </button>
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white p-4">
                            <h2 className="text-base font-semibold text-slate-900">Recent Audit</h2>
                            {audits.length === 0 ? (
                                <p className="mt-3 text-sm text-slate-500">Belum ada audit untuk channel ini.</p>
                            ) : (
                                <div className="mt-3 space-y-2">
                                    {audits.map((audit) => (
                                        <div key={audit.id} className="rounded-md border border-slate-200 p-3 text-sm">
                                            <p className="font-medium text-slate-800">{audit.eventType}</p>
                                            <p className="text-xs text-slate-500">
                                                {new Date(audit.createdAt).toLocaleString("id-ID")} · {audit.status}
                                            </p>
                                            {audit.message ? (
                                                <p className="mt-1 text-slate-700">{audit.message}</p>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
