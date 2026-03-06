import { TenantRole } from "@prisma/client";
import { createTeamInviteAction } from "../actions";
import {
    listOrganizationMembers,
    listOrganizationPendingInvites,
} from "@/lib/auth/tenantAuthService";
import { requireSessionTenantContext } from "@/lib/auth/sessionContext";

export default async function TeamPage() {
    const { organizationId, membershipRole } = await requireSessionTenantContext([
        TenantRole.OWNER,
        TenantRole.ADMIN,
    ]);
    const [members, invites] = await Promise.all([
        listOrganizationMembers(organizationId),
        listOrganizationPendingInvites(organizationId),
    ]);

    const canInvite = membershipRole === TenantRole.OWNER || membershipRole === TenantRole.ADMIN;

    return (
        <section className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Team & Access</h1>
                <p className="text-sm text-slate-500">Manajemen membership organization dan invite anggota via email.</p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Invite Anggota</h2>
                <p className="mt-1 text-sm text-slate-500">Role yang bisa diundang: Admin, Operator, Viewer.</p>

                {canInvite ? (
                    <form action={createTeamInviteAction} className="mt-3 grid gap-3 md:grid-cols-4">
                        <input
                            type="email"
                            name="email"
                            placeholder="user@company.com"
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                            required
                        />
                        <select
                            name="role"
                            defaultValue={TenantRole.VIEWER}
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                            <option value={TenantRole.ADMIN}>Admin</option>
                            <option value={TenantRole.OPERATOR}>Operator</option>
                            <option value={TenantRole.VIEWER}>Viewer</option>
                        </select>
                        <div />
                        <button
                            type="submit"
                            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                        >
                            Kirim Invite
                        </button>
                    </form>
                ) : (
                    <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
                        Hanya OWNER/ADMIN yang dapat mengundang anggota.
                    </p>
                )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Members</h2>
                <div className="mt-3 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Name</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Email</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Role</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Last Login</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {members.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                                        Belum ada anggota.
                                    </td>
                                </tr>
                            ) : (
                                members.map((member) => (
                                    <tr key={member.id}>
                                        <td className="px-3 py-2 text-slate-700">{member.user.name || "-"}</td>
                                        <td className="px-3 py-2 text-slate-700">{member.user.email}</td>
                                        <td className="px-3 py-2 text-slate-700">{member.role}</td>
                                        <td className="px-3 py-2 text-slate-700">
                                            {member.user.lastLoginAt
                                                ? new Date(member.user.lastLoginAt).toLocaleString("id-ID")
                                                : "-"}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Pending Invites</h2>
                <div className="mt-3 overflow-hidden rounded border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Email</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Role</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Invited By</th>
                                <th className="px-3 py-2 text-left font-medium text-slate-600">Expires</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {invites.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                                        Tidak ada invite aktif.
                                    </td>
                                </tr>
                            ) : (
                                invites.map((invite) => (
                                    <tr key={invite.id}>
                                        <td className="px-3 py-2 text-slate-700">{invite.email}</td>
                                        <td className="px-3 py-2 text-slate-700">{invite.role}</td>
                                        <td className="px-3 py-2 text-slate-700">{invite.invitedBy.email}</td>
                                        <td className="px-3 py-2 text-slate-700">
                                            {new Date(invite.expiresAt).toLocaleString("id-ID")}
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
