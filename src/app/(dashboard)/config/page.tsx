import type { ReactNode } from "react";
import { TenantRole } from "@prisma/client";
import { configRepo } from "@/lib/db/configRepo";
import { workspaceCredentialRepo } from "@/lib/db/workspaceCredentialRepo";
import { workspacePromptRepo } from "@/lib/db/workspacePromptRepo";
import { workspaceToolPolicyRepo } from "@/lib/db/workspaceToolPolicyRepo";
import {
    activatePromptVersionAction,
    createPromptVersionAction,
    deleteWorkspaceCredentialAction,
    revokeAllAuthSessionsAction,
    revokeAuthSessionAction,
    updateBotConfigAction,
    upsertWorkspaceCredentialAction,
    upsertWorkspaceToolPolicyAction,
} from "../actions";
import { authSessionRepo } from "@/lib/db/authSessionRepo";
import { requireSessionPermission } from "@/lib/auth/sessionContext";

const KNOWN_TOOLS = [
    "get_user_info",
    "save_note",
    "fetch_smartscholar_endpoint",
    "webhook_action",
    "crm_sync_contact",
    "search_knowledge",
] as const;

const TOOL_ROLE_OPTIONS: TenantRole[] = [
    TenantRole.OWNER,
    TenantRole.ADMIN,
    TenantRole.OPERATOR,
    TenantRole.VIEWER,
];

const BUSINESS_DAY_OPTIONS: Array<{ value: number; label: string }> = [
    { value: 1, label: "Mon" },
    { value: 2, label: "Tue" },
    { value: 3, label: "Wed" },
    { value: 4, label: "Thu" },
    { value: 5, label: "Fri" },
    { value: 6, label: "Sat" },
    { value: 0, label: "Sun" },
];

function formatDateTime(value?: Date | null): string {
    if (!value) return "-";
    return new Date(value).toLocaleString("id-ID");
}

function Field({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: ReactNode;
}) {
    return (
        <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</span>
            {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
            {children}
        </label>
    );
}

export default async function ConfigPage() {
    const { workspaceId, userId } = await requireSessionPermission("manage_channel");
    const [botConfig, sessions, promptVersions, credentials, toolPolicies] = await Promise.all([
        configRepo.getBotConfig(workspaceId),
        authSessionRepo.listActiveSessions(userId),
        workspacePromptRepo.listPromptVersions(workspaceId, 50),
        workspaceCredentialRepo.listCredentialMetas(workspaceId),
        workspaceToolPolicyRepo.listPolicies(workspaceId),
    ]);

    const activePrompt = promptVersions.find((item) => item.isActive) || null;
    const policyByTool = new Map(toolPolicies.map((item) => [item.toolName, item]));
    const selectedBusinessDays = botConfig.businessDays && botConfig.businessDays.length > 0
        ? botConfig.businessDays
        : [1, 2, 3, 4, 5];

    return (
        <section className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Configuration</h1>
                <p className="text-sm text-slate-500">
                    Semua konfigurasi prompt dan runtime dikelola dari database workspace. Tidak ada edit file <code>.md</code> di halaman ini.
                </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Bot Status</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">{botConfig.isActive ? "Active" : "Inactive"}</p>
                    <p className="mt-1 text-xs text-slate-500">Model utama: {botConfig.model}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Prompt Aktif</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">
                        {activePrompt ? `v${activePrompt.version}` : "Belum ada"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{activePrompt?.title || "Buat prompt version baru"}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Security</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">{sessions.length} session aktif</p>
                    <p className="mt-1 text-xs text-slate-500">{credentials.length} credential tersimpan</p>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Bot Runtime</h2>
                <p className="mt-1 text-sm text-slate-500">Atur status bot, model, token, safety, memory retention, dan jam operasional.</p>

                <form action={updateBotConfigAction} className="mt-4 space-y-5">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <Field label="Status">
                            <select
                                name="isActive"
                                defaultValue={botConfig.isActive ? "true" : "false"}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            >
                                <option value="true">Aktif</option>
                                <option value="false">Nonaktif</option>
                            </select>
                        </Field>

                        <Field label="Primary Model" hint="Contoh: gemini-2.5-flash-lite">
                            <input
                                name="model"
                                defaultValue={botConfig.model}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                placeholder="Primary model"
                            />
                        </Field>

                        <Field label="Fallback Models" hint="Pisahkan dengan koma">
                            <input
                                name="fallbackModels"
                                defaultValue={botConfig.fallbackModels.join(", ")}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                placeholder="gemini-2.5-flash, gemini-2.0-flash"
                            />
                        </Field>

                        <Field label="Safety Profile">
                            <select
                                name="safetyProfile"
                                defaultValue={botConfig.safetyProfile}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            >
                                <option value="strict">strict</option>
                                <option value="balanced">balanced</option>
                                <option value="relaxed">relaxed</option>
                            </select>
                        </Field>

                        <Field label="Max Tokens">
                            <input
                                type="number"
                                min={128}
                                max={8192}
                                name="maxTokens"
                                defaultValue={botConfig.maxTokens}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            />
                        </Field>

                        <Field label="Temperature" hint="0.0 - 1.0">
                            <input
                                type="number"
                                min={0}
                                max={1}
                                step="0.1"
                                name="temperature"
                                defaultValue={botConfig.temperature}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            />
                        </Field>

                        <Field label="Memory Retention (Days)">
                            <input
                                type="number"
                                min={1}
                                max={3650}
                                name="memoryRetentionDays"
                                defaultValue={botConfig.memoryRetentionDays}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            />
                        </Field>

                        <Field label="PII Redaction">
                            <select
                                name="piiRedactionEnabled"
                                defaultValue={botConfig.piiRedactionEnabled ? "true" : "false"}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            >
                                <option value="true">On</option>
                                <option value="false">Off</option>
                            </select>
                        </Field>

                        <Field label="Timezone" hint="IANA timezone, mis. Asia/Jakarta">
                            <input
                                name="timezone"
                                defaultValue={botConfig.timezone}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                placeholder="Asia/Jakarta"
                            />
                        </Field>

                        <Field label="Business Hours Start" hint="Format HH:mm">
                            <input
                                name="businessHoursStart"
                                defaultValue={botConfig.businessHoursStart}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                placeholder="08:00"
                            />
                        </Field>

                        <Field label="Business Hours End" hint="Format HH:mm">
                            <input
                                name="businessHoursEnd"
                                defaultValue={botConfig.businessHoursEnd}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                placeholder="20:00"
                            />
                        </Field>

                        <Field label="Out-of-Hours Auto Reply">
                            <select
                                name="outOfHoursAutoReplyEnabled"
                                defaultValue={botConfig.outOfHoursAutoReplyEnabled ? "true" : "false"}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            >
                                <option value="true">On</option>
                                <option value="false">Off</option>
                            </select>
                        </Field>
                    </div>

                    <Field label="Out-of-Hours Message">
                        <input
                            name="outOfHoursMessage"
                            defaultValue={botConfig.outOfHoursMessage}
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Pesan otomatis di luar jam operasional"
                        />
                    </Field>

                    <div className="rounded-md border border-slate-200 px-3 py-3 text-xs text-slate-700">
                        <p className="mb-2 text-sm font-medium text-slate-800">Business Days</p>
                        <div className="flex flex-wrap gap-3">
                            {BUSINESS_DAY_OPTIONS.map((day) => (
                                <label key={`business-day-${day.value}`} className="inline-flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        name="businessDays"
                                        value={day.value}
                                        defaultChecked={selectedBusinessDays.includes(day.value)}
                                    />
                                    {day.label}
                                </label>
                            ))}
                        </div>
                    </div>

                    <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                        Save Runtime Config
                    </button>
                </form>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Prompt Versioning (Database)</h2>
                <p className="mt-1 text-sm text-slate-500">
                    Simpan prompt sebagai versi baru. Versi baru otomatis aktif setelah disimpan.
                </p>

                <div className="mt-3 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Version</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Title</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Created</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {promptVersions.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                                        Belum ada prompt version.
                                    </td>
                                </tr>
                            ) : (
                                promptVersions.map((item) => (
                                    <tr key={item.id}>
                                        <td className="px-3 py-2 text-slate-700">v{item.version}</td>
                                        <td className="px-3 py-2 text-slate-700">{item.title || "-"}</td>
                                        <td className="px-3 py-2 text-slate-700">{item.isActive ? "Active" : "Inactive"}</td>
                                        <td className="px-3 py-2 text-slate-700">{formatDateTime(item.createdAt)}</td>
                                        <td className="px-3 py-2">
                                            <form action={activatePromptVersionAction}>
                                                <input type="hidden" name="versionId" value={item.id} />
                                                <button
                                                    type="submit"
                                                    disabled={item.isActive}
                                                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    Activate
                                                </button>
                                            </form>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <form action={createPromptVersionAction} className="mt-4 space-y-3">
                    <Field label="Version Title" hint="Contoh: Prompt v3 - onboarding focus">
                        <input
                            type="text"
                            name="title"
                            placeholder="Judul versi prompt"
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                    </Field>

                    <Field label="Identity" hint="Wajib diisi">
                        <textarea
                            name="identity"
                            defaultValue={activePrompt?.identity || ""}
                            className="h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Definisikan identitas AI assistant"
                            required
                        />
                    </Field>

                    <Field label="Behavior" hint="Wajib diisi">
                        <textarea
                            name="behavior"
                            defaultValue={activePrompt?.behavior || ""}
                            className="h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Aturan perilaku dan gaya jawaban"
                            required
                        />
                    </Field>

                    <Field label="Skills" hint="Wajib diisi">
                        <textarea
                            name="skills"
                            defaultValue={activePrompt?.skills || ""}
                            className="h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Kemampuan inti yang harus dijalankan"
                            required
                        />
                    </Field>

                    <Field label="Tools" hint="Opsional">
                        <textarea
                            name="tools"
                            defaultValue={activePrompt?.tools || ""}
                            className="h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Aturan penggunaan tool"
                        />
                    </Field>

                    <Field label="Memory" hint="Opsional">
                        <textarea
                            name="memory"
                            defaultValue={activePrompt?.memory || ""}
                            className="h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Aturan ekstraksi/retensi memori"
                        />
                    </Field>

                    <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                        Save As New Prompt Version
                    </button>
                </form>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Credential Vault</h2>
                <p className="mt-1 text-sm text-slate-500">Secret disimpan terenkripsi dan hanya metadata yang ditampilkan di dashboard.</p>

                <div className="mt-3 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Provider</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Updated</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {credentials.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                                        Belum ada credential.
                                    </td>
                                </tr>
                            ) : (
                                credentials.map((item) => (
                                    <tr key={item.id}>
                                        <td className="px-3 py-2 text-slate-700">{item.provider}</td>
                                        <td className="px-3 py-2 text-slate-700">{item.name}</td>
                                        <td className="px-3 py-2 text-slate-700">{formatDateTime(item.updatedAt)}</td>
                                        <td className="px-3 py-2">
                                            <form action={deleteWorkspaceCredentialAction}>
                                                <input type="hidden" name="name" value={item.name} />
                                                <button
                                                    type="submit"
                                                    className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700"
                                                >
                                                    Delete
                                                </button>
                                            </form>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <form action={upsertWorkspaceCredentialAction} className="mt-4 grid gap-3 md:grid-cols-4">
                    <input
                        type="text"
                        name="provider"
                        placeholder="provider (e.g. groq, smartscholar)"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        required
                    />
                    <input
                        type="text"
                        name="name"
                        placeholder="credential name"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        required
                    />
                    <input
                        type="password"
                        name="secret"
                        placeholder="secret"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        required
                    />
                    <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                        Save Credential
                    </button>
                </form>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Tool Permission Matrix</h2>
                <p className="mt-1 text-sm text-slate-500">
                    Kontrol enable/disable tool per workspace dan role yang boleh mengeksekusi tool.
                </p>

                <div className="mt-3 space-y-3">
                    {KNOWN_TOOLS.map((toolName) => {
                        const policy = policyByTool.get(toolName);
                        const isEnabled = policy?.isEnabled ?? true;
                        const allowedRoles = policy?.allowedRoles ?? [TenantRole.OWNER, TenantRole.ADMIN, TenantRole.OPERATOR];

                        return (
                            <form key={toolName} action={upsertWorkspaceToolPolicyAction} className="rounded-md border border-slate-200 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <p className="text-sm font-semibold text-slate-800">{toolName}</p>
                                        <p className="text-xs text-slate-500">Default: enabled untuk OWNER/ADMIN/OPERATOR.</p>
                                    </div>
                                    <select
                                        name="isEnabled"
                                        defaultValue={isEnabled ? "true" : "false"}
                                        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                    >
                                        <option value="true">Enabled</option>
                                        <option value="false">Disabled</option>
                                    </select>
                                </div>

                                <input type="hidden" name="toolName" value={toolName} />

                                <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-700">
                                    {TOOL_ROLE_OPTIONS.map((role) => (
                                        <label key={`${toolName}:${role}`} className="inline-flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                name="allowedRoles"
                                                value={role}
                                                defaultChecked={allowedRoles.includes(role)}
                                            />
                                            {role}
                                        </label>
                                    ))}
                                </div>

                                <button type="submit" className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">
                                    Save Tool Policy
                                </button>
                            </form>
                        );
                    })}
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h2 className="text-base font-semibold text-slate-900">Session Management</h2>
                        <p className="text-sm text-slate-500">Kelola sesi login per perangkat dan revoke jika perlu.</p>
                    </div>
                    <form action={revokeAllAuthSessionsAction}>
                        <button
                            type="submit"
                            className="rounded-md border border-rose-300 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50"
                        >
                            Revoke Semua Session
                        </button>
                    </form>
                </div>

                <div className="mt-3 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Perangkat</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">IP</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Last Seen</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Expires</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {sessions.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                                        Tidak ada session aktif.
                                    </td>
                                </tr>
                            ) : (
                                sessions.map((session) => (
                                    <tr key={session.id}>
                                        <td className="px-3 py-2 text-slate-700">{session.userAgent || "-"}</td>
                                        <td className="px-3 py-2 text-slate-700">{session.ipAddress || "-"}</td>
                                        <td className="px-3 py-2 text-slate-700">{formatDateTime(session.lastSeenAt)}</td>
                                        <td className="px-3 py-2 text-slate-700">{formatDateTime(session.expiresAt)}</td>
                                        <td className="px-3 py-2">
                                            <form action={revokeAuthSessionAction}>
                                                <input type="hidden" name="sessionId" value={session.id} />
                                                <button
                                                    type="submit"
                                                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                                                >
                                                    Revoke
                                                </button>
                                            </form>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
}
