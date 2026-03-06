import { BillingCycle, SubscriptionStatus, TenantRole } from "@prisma/client";
import { toggleOrganizationActiveAction } from "../actions";
import { prisma } from "@/lib/db/client";
import { requireSessionTenantContext } from "@/lib/auth/sessionContext";

const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

function toMonthlyMrr(amountCents: number, cycle: BillingCycle): number {
    if (cycle === BillingCycle.YEARLY) {
        return Math.round(amountCents / 12);
    }
    return amountCents;
}

export default async function SuperAdminPage() {
    const context = await requireSessionTenantContext([TenantRole.OWNER]);
    if (context.platformRole !== TenantRole.OWNER) {
        throw new Error("Forbidden");
    }

    const [organizations, activeSubscriptions, churnedLast30Days] = await Promise.all([
        prisma.organization.findMany({
            orderBy: [{ createdAt: "desc" }],
            include: {
                _count: {
                    select: {
                        memberships: true,
                        workspaces: true,
                    },
                },
                subscriptions: {
                    orderBy: [{ createdAt: "desc" }],
                    take: 1,
                    include: {
                        plan: true,
                    },
                },
            },
        }),
        prisma.subscription.findMany({
            where: {
                status: {
                    in: [
                        SubscriptionStatus.ACTIVE,
                        SubscriptionStatus.TRIALING,
                        SubscriptionStatus.PAST_DUE,
                    ],
                },
            },
            include: {
                plan: true,
                organization: {
                    select: {
                        isActive: true,
                    },
                },
            },
        }),
        prisma.subscription.count({
            where: {
                status: {
                    in: [SubscriptionStatus.CANCELED, SubscriptionStatus.EXPIRED],
                },
                updatedAt: {
                    gte: THIRTY_DAYS_AGO,
                },
            },
        }),
    ]);

    const activeTenants = organizations.filter((item) => item.isActive).length;
    const suspendedTenants = organizations.length - activeTenants;
    const estimatedMrrCents = activeSubscriptions
        .filter((subscription) => subscription.organization.isActive)
        .reduce((sum, subscription) => (
            sum + toMonthlyMrr(
                subscription.billingCycle === BillingCycle.YEARLY
                    ? (subscription.plan.yearlyPriceCents ?? subscription.plan.monthlyPriceCents * 12)
                    : subscription.plan.monthlyPriceCents,
                subscription.billingCycle
            )
        ), 0);

    return (
        <section className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Super Admin Console</h1>
                <p className="text-sm text-slate-500">Monitoring tenant global, suspend/unsuspend org, dan metrik revenue/churn.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">Total Tenants</p>
                    <p className="text-lg font-semibold text-slate-900">{organizations.length.toLocaleString("id-ID")}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">Active Tenants</p>
                    <p className="text-lg font-semibold text-slate-900">{activeTenants.toLocaleString("id-ID")}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">Suspended</p>
                    <p className="text-lg font-semibold text-slate-900">{suspendedTenants.toLocaleString("id-ID")}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">Estimated MRR</p>
                    <p className="text-lg font-semibold text-slate-900">${(estimatedMrrCents / 100).toLocaleString("en-US")}</p>
                    <p className="text-xs text-slate-500">Churn 30d: {churnedLast30Days}</p>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Tenant List</h2>
                <div className="mt-4 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Organization</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Plan</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Members</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Workspaces</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {organizations.map((organization) => {
                                const latestSubscription = organization.subscriptions[0];
                                return (
                                    <tr key={organization.id}>
                                        <td className="px-3 py-2">
                                            <p className="font-medium text-slate-800">{organization.name}</p>
                                            <p className="text-xs text-slate-500">{organization.slug}</p>
                                        </td>
                                        <td className="px-3 py-2 text-slate-700">{organization.isActive ? "Active" : "Suspended"}</td>
                                        <td className="px-3 py-2 text-slate-700">
                                            {latestSubscription ? `${latestSubscription.plan.code} (${latestSubscription.status})` : "-"}
                                        </td>
                                        <td className="px-3 py-2 text-slate-700">{organization._count.memberships}</td>
                                        <td className="px-3 py-2 text-slate-700">{organization._count.workspaces}</td>
                                        <td className="px-3 py-2">
                                            <form action={toggleOrganizationActiveAction}>
                                                <input type="hidden" name="organizationId" value={organization.id} />
                                                <input type="hidden" name="nextIsActive" value={organization.isActive ? "false" : "true"} />
                                                <button
                                                    type="submit"
                                                    className={`rounded-md px-2 py-1 text-xs font-medium ${
                                                        organization.isActive
                                                            ? "border border-rose-300 text-rose-700"
                                                            : "border border-emerald-300 text-emerald-700"
                                                    }`}
                                                >
                                                    {organization.isActive ? "Suspend" : "Unsuspend"}
                                                </button>
                                            </form>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
}
