import { configRepo } from "@/lib/db/configRepo";
import { messageRepo } from "@/lib/db/messageRepo";
import { userRepo } from "@/lib/db/userRepo";
import { toggleBotActive } from "./actions";
import { WaStatusCard } from "@/components/dashboard/WaStatusCard";
import { requireSessionPermission } from "@/lib/auth/sessionContext";

function formatDuration(ms: number | null): string {
    if (ms === null) return "-";

    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds} detik`;

    const minutes = Math.floor(seconds / 60);
    const remSeconds = seconds % 60;
    return `${minutes}m ${remSeconds}s`;
}

export default async function DashboardOverviewPage() {
    const { workspaceId } = await requireSessionPermission("read");
    const [totalUsers, totalMessagesToday, avgResponseMs, botConfig] = await Promise.all([
        userRepo.getTotalUsers(workspaceId),
        messageRepo.getTodayMessageCount(workspaceId),
        messageRepo.getTodayAverageResponseTimeMs(workspaceId),
        configRepo.getBotConfig(workspaceId),
    ]);

    return (
        <section className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
                <p className="text-sm text-slate-500">Ringkasan performa bot hari ini.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-sm text-slate-500">Total Users</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{totalUsers}</p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-sm text-slate-500">Pesan Hari Ini</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{totalMessagesToday}</p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-sm text-slate-500">Avg Response Time</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{formatDuration(avgResponseMs)}</p>
                </div>

                <WaStatusCard />

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-sm text-slate-500">Status Bot</p>
                    <p className={`mt-2 text-2xl font-semibold ${botConfig.isActive ? "text-emerald-600" : "text-rose-600"}`}>
                        {botConfig.isActive ? "Aktif" : "Nonaktif"}
                    </p>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Kontrol Bot</h2>
                <p className="mt-1 text-sm text-slate-500">
                    Toggle ini mengubah `BotConfig.isActive` untuk mengizinkan/menghentikan respons otomatis.
                </p>

                <form action={toggleBotActive} className="mt-4">
                    <input type="hidden" name="current" value={botConfig.isActive ? "true" : "false"} />
                    <button
                        type="submit"
                        className={`rounded-md px-4 py-2 text-sm font-medium text-white ${
                            botConfig.isActive ? "bg-rose-600 hover:bg-rose-500" : "bg-emerald-600 hover:bg-emerald-500"
                        }`}
                    >
                        {botConfig.isActive ? "Nonaktifkan Bot" : "Aktifkan Bot"}
                    </button>
                </form>
            </div>
        </section>
    );
}
