import { TenantRole } from "@prisma/client";
import { createOrganizationWorkspaceAction, updateOrganizationSettingsAction } from "../actions";
import { listOrganizationMembers } from "@/lib/auth/tenantAuthService";
import { prisma } from "@/lib/db/client";
import { requireSessionTenantContext } from "@/lib/auth/sessionContext";

export default async function OrganizationPage() {
    const { organizationId, membershipRole, workspaceId } = await requireSessionTenantContext();
    const canManage = membershipRole === TenantRole.OWNER || membershipRole === TenantRole.ADMIN;

    const [organization, members, workspaces] = await Promise.all([
        prisma.organization.findUnique({
            where: { id: organizationId },
            include: {
                _count: {
                    select: {
                        memberships: true,
                        workspaces: true,
                    },
                },
            },
        }),
        listOrganizationMembers(organizationId),
        prisma.workspace.findMany({
            where: { organizationId },
            orderBy: [{ createdAt: "asc" }],
            include: {
                _count: {
                    select: {
                        channels: true,
                        chatUsers: true,
                        messages: true,
                    },
                },
            },
        }),
    ]);

    if (!organization) {
        throw new Error("Organization not found");
    }

    return (
        <section className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Organization Settings</h1>
                <p className="text-sm text-slate-500">Kelola profil organisasi dan workspace yang dimiliki tenant.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">Organization</p>
                    <p className="text-lg font-semibold text-slate-900">{organization.name}</p>
                    <p className="text-xs text-slate-500">Slug: {organization.slug}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">Members</p>
                    <p className="text-lg font-semibold text-slate-900">{organization._count.memberships.toLocaleString("id-ID")}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">Workspaces</p>
                    <p className="text-lg font-semibold text-slate-900">{organization._count.workspaces.toLocaleString("id-ID")}</p>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Profile</h2>
                {canManage ? (
                    <form action={updateOrganizationSettingsAction} className="mt-3 grid gap-3 md:grid-cols-2">
                        <input
                            type="text"
                            name="name"
                            defaultValue={organization.name}
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Organization name"
                            required
                        />
                        <input
                            type="text"
                            name="slug"
                            defaultValue={organization.slug}
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                            placeholder="organization-slug"
                        />
                        <button
                            type="submit"
                            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white md:col-span-2"
                        >
                            Save Organization
                        </button>
                    </form>
                ) : (
                    <p className="mt-3 text-sm text-slate-500">Anda tidak memiliki akses untuk mengubah organization settings.</p>
                )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Workspaces</h2>
                {canManage ? (
                    <form action={createOrganizationWorkspaceAction} className="mt-3 grid gap-3 md:grid-cols-3">
                        <input
                            type="text"
                            name="name"
                            placeholder="Workspace name"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                            required
                        />
                        <input
                            type="text"
                            name="slug"
                            placeholder="workspace-slug (optional)"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                        <button
                            type="submit"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
                        >
                            Create Workspace
                        </button>
                    </form>
                ) : null}

                <div className="mt-4 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Workspace</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Channels</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Users</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Messages</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {workspaces.map((workspace) => (
                                <tr key={workspace.id}>
                                    <td className="px-3 py-2">
                                        <p className="font-medium text-slate-800">{workspace.name}</p>
                                        <p className="text-xs text-slate-500">{workspace.slug}</p>
                                        {workspace.id === workspaceId ? (
                                            <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">
                                                Current
                                            </span>
                                        ) : null}
                                    </td>
                                    <td className="px-3 py-2 text-slate-700">{workspace.isActive ? "Active" : "Inactive"}</td>
                                    <td className="px-3 py-2 text-slate-700">{workspace._count.channels}</td>
                                    <td className="px-3 py-2 text-slate-700">{workspace._count.chatUsers}</td>
                                    <td className="px-3 py-2 text-slate-700">{workspace._count.messages}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Member Overview</h2>
                <div className="mt-4 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Email</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Role</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {members.map((member) => (
                                <tr key={member.id}>
                                    <td className="px-3 py-2 text-slate-700">{member.user.name || "-"}</td>
                                    <td className="px-3 py-2 text-slate-700">{member.user.email}</td>
                                    <td className="px-3 py-2 text-slate-700">{member.role}</td>
                                    <td className="px-3 py-2 text-slate-700">{member.user.isActive ? "Active" : "Inactive"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
}
