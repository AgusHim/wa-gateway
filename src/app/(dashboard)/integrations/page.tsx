import { WebhookEndpointStatus, WebhookEventType } from "@prisma/client";
import {
    createSandboxWorkspaceAction,
    createWebhookEndpointAction,
    createWorkspaceApiKeyAction,
    replayWebhookDeliveryAction,
    revokeWorkspaceApiKeyAction,
    rotateWorkspaceApiKeyAction,
    updateWebhookEndpointStatusAction,
} from "../actions";
import { requireSessionPermission } from "@/lib/auth/sessionContext";
import { workspaceApiKeyRepo } from "@/lib/db/workspaceApiKeyRepo";
import { webhookService } from "@/lib/integrations/webhookService";
import type { PageWithSearchParams } from "@/types/dashboard";

type IntegrationsSearchParams = {
    newApiKey?: string;
    keyName?: string;
    rotatedApiKey?: string;
    keyId?: string;
    sandboxWorkspaceId?: string;
};

function formatDateTime(value?: Date | null): string {
    if (!value) return "-";
    return new Date(value).toLocaleString("id-ID");
}

const WEBHOOK_EVENTS: WebhookEventType[] = [
    WebhookEventType.MESSAGE_RECEIVED,
    WebhookEventType.MESSAGE_SENT,
    WebhookEventType.HANDOVER_CREATED,
    WebhookEventType.TOOL_FAILED,
];

export default async function IntegrationsPage({
    searchParams,
}: PageWithSearchParams<IntegrationsSearchParams>) {
    const { workspaceId } = await requireSessionPermission("manage_channel");
    const params = await searchParams;

    const [apiKeys, endpoints, deliveries] = await Promise.all([
        workspaceApiKeyRepo.listKeys(workspaceId),
        webhookService.listEndpoints(workspaceId),
        webhookService.listDeliveries(workspaceId, 200),
    ]);

    return (
        <section className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Integrations</h1>
                <p className="text-sm text-slate-500">Public API key management, outbound webhooks, retry queue, dan replay logs.</p>
            </div>

            {params.newApiKey ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-900">API key baru untuk {params.keyName || "integration"}:</p>
                    <code className="mt-2 block overflow-x-auto rounded bg-white px-3 py-2 text-xs text-slate-900">{params.newApiKey}</code>
                    <p className="mt-2 text-xs text-amber-800">Simpan key ini sekarang. Key tidak bisa ditampilkan ulang setelah halaman ini ditutup.</p>
                </div>
            ) : null}

            {params.rotatedApiKey ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-900">API key hasil rotate:</p>
                    <code className="mt-2 block overflow-x-auto rounded bg-white px-3 py-2 text-xs text-slate-900">{params.rotatedApiKey}</code>
                    <p className="mt-2 text-xs text-amber-800">Segera update credential di sisi integrator.</p>
                </div>
            ) : null}

            {params.sandboxWorkspaceId ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm text-emerald-900">
                        Sandbox workspace berhasil dibuat: <code>{params.sandboxWorkspaceId}</code>
                    </p>
                </div>
            ) : null}

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Sandbox Workspace</h2>
                <p className="mt-1 text-sm text-slate-500">
                    Buat workspace sandbox baru untuk testing integrator tanpa mengganggu workspace produksi.
                </p>
                <form action={createSandboxWorkspaceAction} className="mt-3">
                    <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700">
                        Create Sandbox Workspace
                    </button>
                </form>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Public API Keys</h2>
                <p className="mt-1 text-sm text-slate-500">
                    Scope tersedia: <code>messages:send</code>, <code>contacts:write</code>, <code>conversations:read</code>, <code>usage:read</code>.
                </p>
                <p className="mt-1 text-xs text-amber-700">
                    Gunakan full API key yang tampil sekali saat create/rotate. Nilai di kolom Prefix bukan credential untuk request API.
                </p>

                <form action={createWorkspaceApiKeyAction} className="mt-4 grid gap-3 md:grid-cols-3">
                    <input
                        type="text"
                        name="name"
                        placeholder="Key name (e.g. crm-prod)"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        required
                    />
                    <input
                        type="text"
                        name="scopes"
                        placeholder="messages:send,contacts:write"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                        type="datetime-local"
                        name="expiresAt"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button
                        type="submit"
                        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white md:col-span-3"
                    >
                        Create API Key
                    </button>
                </form>

                <div className="mt-4 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Key Prefix (not secret)</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Scopes</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Last Used</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {apiKeys.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-3 py-5 text-center text-slate-500">
                                        Belum ada API key.
                                    </td>
                                </tr>
                            ) : (
                                apiKeys.map((key) => (
                                    <tr key={key.id}>
                                        <td className="px-3 py-2 text-slate-800">{key.name}</td>
                                        <td className="px-3 py-2 text-slate-700">{key.keyPrefix}</td>
                                        <td className="px-3 py-2 text-slate-700">{key.scopes.join(", ") || "*"}</td>
                                        <td className="px-3 py-2 text-slate-700">{key.status}</td>
                                        <td className="px-3 py-2 text-slate-700">{formatDateTime(key.lastUsedAt)}</td>
                                        <td className="px-3 py-2">
                                            <div className="flex flex-wrap gap-2">
                                                <form action={rotateWorkspaceApiKeyAction}>
                                                    <input type="hidden" name="keyId" value={key.id} />
                                                    <button
                                                        type="submit"
                                                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                                                    >
                                                        Rotate
                                                    </button>
                                                </form>
                                                {key.status !== "REVOKED" ? (
                                                    <form action={revokeWorkspaceApiKeyAction}>
                                                        <input type="hidden" name="keyId" value={key.id} />
                                                        <button
                                                            type="submit"
                                                            className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700"
                                                        >
                                                            Revoke
                                                        </button>
                                                    </form>
                                                ) : null}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Webhook Endpoints</h2>
                <form action={createWebhookEndpointAction} className="mt-4 grid gap-3 md:grid-cols-3">
                    <input
                        type="text"
                        name="name"
                        placeholder="Endpoint name"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        required
                    />
                    <input
                        type="url"
                        name="url"
                        placeholder="https://example.com/webhook"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                        required
                    />
                    <input
                        type="text"
                        name="secret"
                        placeholder="Webhook secret (HMAC)"
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                        required
                    />
                    <div className="grid grid-cols-2 gap-2">
                        <input
                            type="number"
                            name="timeoutMs"
                            min={1000}
                            max={30000}
                            defaultValue={10000}
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                        <input
                            type="number"
                            name="maxAttempts"
                            min={1}
                            max={20}
                            defaultValue={6}
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                    </div>

                    <div className="md:col-span-3 flex flex-wrap gap-3 rounded-md border border-slate-200 p-3">
                        {WEBHOOK_EVENTS.map((eventType) => (
                            <label key={eventType} className="flex items-center gap-2 text-sm text-slate-700">
                                <input type="checkbox" name="events" value={eventType} defaultChecked />
                                {eventType}
                            </label>
                        ))}
                    </div>

                    <button
                        type="submit"
                        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white md:col-span-3"
                    >
                        Add Webhook Endpoint
                    </button>
                </form>

                <div className="mt-4 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">URL</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Events</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Last Delivery</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {endpoints.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-3 py-5 text-center text-slate-500">
                                        Belum ada webhook endpoint.
                                    </td>
                                </tr>
                            ) : (
                                endpoints.map((endpoint) => (
                                    <tr key={endpoint.id}>
                                        <td className="px-3 py-2 text-slate-800">{endpoint.name}</td>
                                        <td className="px-3 py-2 text-slate-700">{endpoint.url}</td>
                                        <td className="px-3 py-2 text-slate-700">{endpoint.events.join(", ")}</td>
                                        <td className="px-3 py-2 text-slate-700">{endpoint.status}</td>
                                        <td className="px-3 py-2 text-slate-700">{formatDateTime(endpoint.lastDeliveredAt)}</td>
                                        <td className="px-3 py-2">
                                            <div className="flex flex-wrap gap-2">
                                                {endpoint.status !== WebhookEndpointStatus.ACTIVE ? (
                                                    <form action={updateWebhookEndpointStatusAction}>
                                                        <input type="hidden" name="endpointId" value={endpoint.id} />
                                                        <input type="hidden" name="status" value={WebhookEndpointStatus.ACTIVE} />
                                                        <button className="rounded-md border border-emerald-300 px-2 py-1 text-xs text-emerald-700">
                                                            Activate
                                                        </button>
                                                    </form>
                                                ) : (
                                                    <form action={updateWebhookEndpointStatusAction}>
                                                        <input type="hidden" name="endpointId" value={endpoint.id} />
                                                        <input type="hidden" name="status" value={WebhookEndpointStatus.PAUSED} />
                                                        <button className="rounded-md border border-amber-300 px-2 py-1 text-xs text-amber-700">
                                                            Pause
                                                        </button>
                                                    </form>
                                                )}
                                                <form action={updateWebhookEndpointStatusAction}>
                                                    <input type="hidden" name="endpointId" value={endpoint.id} />
                                                    <input type="hidden" name="status" value={WebhookEndpointStatus.REVOKED} />
                                                    <button className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700">
                                                        Revoke
                                                    </button>
                                                </form>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Webhook Delivery Logs</h2>
                <div className="mt-4 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Time</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Endpoint</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Event</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Attempt</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Response</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {deliveries.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-3 py-5 text-center text-slate-500">
                                        Belum ada delivery log.
                                    </td>
                                </tr>
                            ) : (
                                deliveries.map((delivery) => (
                                    <tr key={delivery.id}>
                                        <td className="px-3 py-2 text-slate-700">{formatDateTime(delivery.createdAt)}</td>
                                        <td className="px-3 py-2 text-slate-700">{delivery.endpoint.name}</td>
                                        <td className="px-3 py-2 text-slate-700">{delivery.eventType}</td>
                                        <td className="px-3 py-2 text-slate-700">{delivery.status}</td>
                                        <td className="px-3 py-2 text-slate-700">{delivery.attempt}</td>
                                        <td className="px-3 py-2 text-slate-700">
                                            {delivery.responseStatus ?? "-"}
                                            {delivery.error ? ` (${delivery.error})` : ""}
                                        </td>
                                        <td className="px-3 py-2">
                                            {(delivery.status === "FAILED" || delivery.status === "DEAD" || delivery.status === "CANCELED") ? (
                                                <form action={replayWebhookDeliveryAction}>
                                                    <input type="hidden" name="deliveryId" value={delivery.id} />
                                                    <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700">
                                                        Replay
                                                    </button>
                                                </form>
                                            ) : (
                                                <span className="text-xs text-slate-500">-</span>
                                            )}
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
