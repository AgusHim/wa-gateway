import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { TopBar } from "@/components/dashboard/TopBar";

export const runtime = "nodejs";

export default async function DashboardLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    const session = await getServerSession(authOptions);

    if (!session || session.error) {
        redirect("/login");
    }

    const membershipRole = session.user.membershipRole;
    const platformRole = session.user.platformRole;

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 lg:flex">
            <Sidebar membershipRole={membershipRole} platformRole={platformRole} />

            <div className="flex min-h-screen flex-1 flex-col">
                <TopBar />
                <main className="flex-1 p-6">{children}</main>
            </div>
        </div>
    );
}
