import { BillingCycle } from "@prisma/client";
import {
    cancelBillingSubscriptionAction,
    changeBillingPlanAction,
    retryFailedBillingEventsAction,
} from "../actions";
import { billingService } from "@/lib/billing/service";
import { requireSessionPermission } from "@/lib/auth/sessionContext";

function formatMoney(cents: number, currency: string): string {
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(cents / 100);
}

function usageClass(hardLimitReached: boolean, softLimitReached: boolean): string {
    if (hardLimitReached) return "text-rose-700";
    if (softLimitReached) return "text-amber-700";
    return "text-emerald-700";
}

export default async function BillingPage() {
    const { workspaceId } = await requireSessionPermission("manage_billing");
    const snapshot = await billingService.getBillingSnapshot(workspaceId);

    const metrics = [
        {
            label: "Messages",
            used: snapshot.usage.messages.used,
            limit: snapshot.usage.messages.limit,
            softLimitReached: snapshot.usage.messages.softLimitReached,
            hardLimitReached: snapshot.usage.messages.hardLimitReached,
        },
        {
            label: "Instagram Inbound",
            used: snapshot.usage.instagramInbound.used,
            limit: snapshot.usage.instagramInbound.limit,
            softLimitReached: snapshot.usage.instagramInbound.softLimitReached,
            hardLimitReached: snapshot.usage.instagramInbound.hardLimitReached,
        },
        {
            label: "Instagram Outbound DM",
            used: snapshot.usage.instagramOutbound.used,
            limit: snapshot.usage.instagramOutbound.limit,
            softLimitReached: snapshot.usage.instagramOutbound.softLimitReached,
            hardLimitReached: snapshot.usage.instagramOutbound.hardLimitReached,
        },
        {
            label: "Instagram Comment Replies",
            used: snapshot.usage.instagramCommentReplies.used,
            limit: snapshot.usage.instagramCommentReplies.limit,
            softLimitReached: snapshot.usage.instagramCommentReplies.softLimitReached,
            hardLimitReached: snapshot.usage.instagramCommentReplies.hardLimitReached,
        },
        {
            label: "AI Tokens",
            used: snapshot.usage.aiTokens.used,
            limit: snapshot.usage.aiTokens.limit,
            softLimitReached: snapshot.usage.aiTokens.softLimitReached,
            hardLimitReached: snapshot.usage.aiTokens.hardLimitReached,
        },
        {
            label: "Tool Calls",
            used: snapshot.usage.toolCalls.used,
            limit: snapshot.usage.toolCalls.limit,
            softLimitReached: snapshot.usage.toolCalls.softLimitReached,
            hardLimitReached: snapshot.usage.toolCalls.hardLimitReached,
        },
        {
            label: "Channels",
            used: snapshot.usage.channels.used,
            limit: snapshot.usage.channels.limit,
            softLimitReached: snapshot.usage.channels.softLimitReached,
            hardLimitReached: snapshot.usage.channels.hardLimitReached,
        },
        {
            label: "Seats",
            used: snapshot.usage.seats.used,
            limit: snapshot.usage.seats.limit,
            softLimitReached: snapshot.usage.seats.softLimitReached,
            hardLimitReached: snapshot.usage.seats.hardLimitReached,
        },
    ];

    return (
        <section className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Billing</h1>
                <p className="text-sm text-slate-500">Plan, subscription lifecycle, usage metering, dan invoice history.</p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Current Subscription</h2>
                <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                    <div>
                        <p className="text-xs text-slate-500">Plan</p>
                        <p className="font-semibold text-slate-800">{snapshot.subscription.plan.name}</p>
                    </div>
                    <div>
                        <p className="text-xs text-slate-500">Status</p>
                        <p className="font-semibold text-slate-800">{snapshot.subscription.status}</p>
                    </div>
                    <div>
                        <p className="text-xs text-slate-500">Billing Cycle</p>
                        <p className="font-semibold text-slate-800">{snapshot.subscription.billingCycle}</p>
                    </div>
                    <div>
                        <p className="text-xs text-slate-500">Periode</p>
                        <p className="font-semibold text-slate-800">
                            {new Date(snapshot.subscription.currentPeriodStart).toLocaleDateString("id-ID")}
                            {" - "}
                            {new Date(snapshot.subscription.currentPeriodEnd).toLocaleDateString("id-ID")}
                        </p>
                    </div>
                </div>

                {snapshot.subscription.trialEndAt ? (
                    <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
                        Trial sampai {new Date(snapshot.subscription.trialEndAt).toLocaleString("id-ID")}
                    </p>
                ) : null}

                {snapshot.subscription.graceUntil ? (
                    <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
                        Past due grace period sampai {new Date(snapshot.subscription.graceUntil).toLocaleString("id-ID")}
                    </p>
                ) : null}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Change Plan</h2>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {snapshot.plans.map((plan) => (
                        <form key={plan.code} action={changeBillingPlanAction} className="rounded-md border border-slate-200 p-3">
                            <p className="font-semibold text-slate-800">{plan.name}</p>
                            <p className="mt-1 text-sm text-slate-600">{plan.description || "-"}</p>
                            <p className="mt-2 text-sm text-slate-700">
                                Bulanan: {formatMoney(plan.monthlyPriceCents, plan.currency)}
                            </p>
                            <p className="text-sm text-slate-700">
                                Tahunan: {formatMoney(plan.yearlyPriceCents ?? plan.monthlyPriceCents * 12, plan.currency)}
                            </p>

                            <input type="hidden" name="planCode" value={plan.code} />
                            <select
                                name="billingCycle"
                                defaultValue={snapshot.subscription.billingCycle}
                                className="mt-3 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                            >
                                <option value={BillingCycle.MONTHLY}>MONTHLY</option>
                                <option value={BillingCycle.YEARLY}>YEARLY</option>
                            </select>

                            <button
                                type="submit"
                                disabled={snapshot.subscription.plan.code === plan.code}
                                className="mt-3 w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {snapshot.subscription.plan.code === plan.code ? "Current" : "Pilih Plan"}
                            </button>
                        </form>
                    ))}
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Usage ({snapshot.usage.month})</h2>
                <div className="mt-3 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Metric</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Used</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Limit</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {metrics.map((metric) => (
                                <tr key={metric.label}>
                                    <td className="px-3 py-2 text-slate-700">{metric.label}</td>
                                    <td className="px-3 py-2 text-slate-700">{metric.used.toLocaleString("id-ID")}</td>
                                    <td className="px-3 py-2 text-slate-700">{metric.limit.toLocaleString("id-ID")}</td>
                                    <td className={`px-3 py-2 font-medium ${usageClass(metric.hardLimitReached, metric.softLimitReached)}`}>
                                        {metric.hardLimitReached
                                            ? "Hard limit reached"
                                            : metric.softLimitReached
                                                ? "Soft limit warning"
                                                : "Normal"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-slate-900">Invoice History</h2>
                    <form action={retryFailedBillingEventsAction} className="flex items-center gap-2">
                        <input
                            type="number"
                            name="limit"
                            defaultValue={20}
                            min={1}
                            max={100}
                            className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        />
                        <button
                            type="submit"
                            className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700"
                        >
                            Retry Failed Webhook
                        </button>
                    </form>
                </div>

                <div className="mt-3 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Invoice</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Amount</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Period</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Paid At</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {snapshot.invoices.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                                        Belum ada invoice.
                                    </td>
                                </tr>
                            ) : (
                                snapshot.invoices.map((invoice) => (
                                    <tr key={invoice.id}>
                                        <td className="px-3 py-2 text-slate-700">{invoice.invoiceNumber}</td>
                                        <td className="px-3 py-2 text-slate-700">{invoice.status}</td>
                                        <td className="px-3 py-2 text-slate-700">{formatMoney(invoice.amountTotalCents, invoice.currency)}</td>
                                        <td className="px-3 py-2 text-slate-700">
                                            {new Date(invoice.periodStart).toLocaleDateString("id-ID")}
                                            {" - "}
                                            {new Date(invoice.periodEnd).toLocaleDateString("id-ID")}
                                        </td>
                                        <td className="px-3 py-2 text-slate-700">
                                            {invoice.paidAt
                                                ? new Date(invoice.paidAt).toLocaleString("id-ID")
                                                : "-"}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
                <h2 className="text-base font-semibold text-rose-900">Cancel Subscription</h2>
                <p className="mt-1 text-sm text-rose-700">Pilih metode pembatalan subscription.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                    <form action={cancelBillingSubscriptionAction}>
                        <input type="hidden" name="immediate" value="false" />
                        <button type="submit" className="rounded-md border border-rose-300 bg-white px-3 py-2 text-sm text-rose-700">
                            Cancel at Period End
                        </button>
                    </form>
                    <form action={cancelBillingSubscriptionAction}>
                        <input type="hidden" name="immediate" value="true" />
                        <button type="submit" className="rounded-md bg-rose-700 px-3 py-2 text-sm text-white">
                            Cancel Immediately
                        </button>
                    </form>
                </div>
            </div>
        </section>
    );
}
