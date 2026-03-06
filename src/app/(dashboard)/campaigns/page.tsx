import { CampaignStatus } from "@prisma/client";
import { createCampaignAction, dispatchCampaignNowAction } from "../actions";
import { requireSessionPermission } from "@/lib/auth/sessionContext";
import { hasTenantPermission } from "@/lib/auth/policy";
import { campaignService } from "@/lib/automation/campaignService";

function formatDateTime(value?: Date | null): string {
    if (!value) return "-";
    return new Date(value).toLocaleString("id-ID");
}

function formatPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

export default async function CampaignsPage() {
    const { workspaceId, membershipRole } = await requireSessionPermission("read");
    const canWrite = hasTenantPermission(membershipRole, "write");
    const canManageChannel = hasTenantPermission(membershipRole, "manage_channel");

    const [campaigns, aggregate] = await Promise.all([
        campaignService.listCampaigns(workspaceId, 100),
        campaignService.getCampaignAnalytics(workspaceId),
    ]);

    const summaryEntries = await Promise.all(
        campaigns.map(async (campaign) => [campaign.id, await campaignService.getCampaignSummary(workspaceId, campaign.id)] as const)
    );
    const summaryByCampaign = new Map(summaryEntries);

    return (
        <section className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Campaigns</h1>
                <p className="text-sm text-slate-500">Segment builder, scheduled broadcast, dan analytics campaign.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">Delivered</p>
                    <p className="text-xl font-semibold text-slate-900">{aggregate.delivered.toLocaleString("id-ID")}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">Replied</p>
                    <p className="text-xl font-semibold text-slate-900">{aggregate.replied.toLocaleString("id-ID")}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">Converted</p>
                    <p className="text-xl font-semibold text-slate-900">{aggregate.converted.toLocaleString("id-ID")}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">Reply Rate</p>
                    <p className="text-xl font-semibold text-slate-900">{formatPercent(aggregate.replyRate)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">Conversion Rate</p>
                    <p className="text-xl font-semibold text-slate-900">{formatPercent(aggregate.conversionRate)}</p>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Create Campaign</h2>
                <p className="mt-1 text-sm text-slate-500">
                    Gunakan segment filter: label + last activity + custom field memory. Template mendukung {"{{name}}"} dan {"{{phone}}"}.
                </p>

                {canWrite ? (
                    <form action={createCampaignAction} className="mt-4 grid gap-3 md:grid-cols-2">
                        <input
                            type="text"
                            name="name"
                            placeholder="Campaign name"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                            required
                        />
                        <input
                            type="number"
                            name="throttlePerSecond"
                            min={1}
                            max={100}
                            defaultValue={5}
                            placeholder="Throttle / sec"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />

                        <textarea
                            name="messageTemplate"
                            rows={4}
                            placeholder="Halo {{name}}, ini info terbaru untuk Anda..."
                            className="md:col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                            required
                        />

                        <input
                            type="text"
                            name="label"
                            placeholder="Filter label (optional)"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                        <input
                            type="text"
                            name="segment"
                            placeholder="Filter segment (optional)"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />

                        <input
                            type="number"
                            name="lastActiveWithinDays"
                            min={1}
                            max={3650}
                            placeholder="Last active within days"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                        <input
                            type="datetime-local"
                            name="scheduledAt"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />

                        <input
                            type="text"
                            name="memoryKey"
                            placeholder="Custom field key (memory)"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                        <input
                            type="text"
                            name="memoryValueContains"
                            placeholder="Custom field value contains"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />

                        <button
                            type="submit"
                            className="md:col-span-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                        >
                            Create Campaign
                        </button>
                    </form>
                ) : (
                    <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
                        Role Anda tidak memiliki akses write untuk membuat campaign.
                    </p>
                )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Campaign List</h2>
                <div className="mt-3 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Audience</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Schedule</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Analytics</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {campaigns.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-3 py-5 text-center text-slate-500">
                                        Belum ada campaign.
                                    </td>
                                </tr>
                            ) : (
                                campaigns.map((campaign) => {
                                    const summary = summaryByCampaign.get(campaign.id) || {
                                        total: 0,
                                        delivered: 0,
                                        replied: 0,
                                        converted: 0,
                                        failed: 0,
                                        replyRate: 0,
                                        conversionRate: 0,
                                    };
                                    const canDispatch = canManageChannel
                                        && (campaign.status === CampaignStatus.SCHEDULED || campaign.status === CampaignStatus.FAILED);

                                    return (
                                        <tr key={campaign.id}>
                                            <td className="px-3 py-2">
                                                <p className="font-medium text-slate-800">{campaign.name}</p>
                                                <p className="text-xs text-slate-500">Dibuat: {formatDateTime(campaign.createdAt)}</p>
                                            </td>
                                            <td className="px-3 py-2 text-slate-700">{campaign.status}</td>
                                            <td className="px-3 py-2 text-slate-700">
                                                {campaign._count.recipients.toLocaleString("id-ID")}
                                            </td>
                                            <td className="px-3 py-2 text-slate-700">
                                                <p>{formatDateTime(campaign.scheduledAt)}</p>
                                                <p className="text-xs text-slate-500">Throttle: {campaign.throttlePerSecond}/detik</p>
                                            </td>
                                            <td className="px-3 py-2 text-slate-700">
                                                <p>Delivered: {summary.delivered}</p>
                                                <p>Replied: {summary.replied}</p>
                                                <p>Converted: {summary.converted}</p>
                                                <p className="text-xs text-slate-500">
                                                    RR {formatPercent(summary.replyRate)} | CR {formatPercent(summary.conversionRate)}
                                                </p>
                                            </td>
                                            <td className="px-3 py-2">
                                                {canDispatch ? (
                                                    <form action={dispatchCampaignNowAction}>
                                                        <input type="hidden" name="campaignId" value={campaign.id} />
                                                        <button
                                                            type="submit"
                                                            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700"
                                                        >
                                                            Dispatch Now
                                                        </button>
                                                    </form>
                                                ) : (
                                                    <span className="text-xs text-slate-500">-</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
}
