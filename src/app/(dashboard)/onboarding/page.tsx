import Link from "next/link";
import { getOnboardingChecklist } from "@/lib/onboarding/checklist";
import { requireSessionPermission } from "@/lib/auth/sessionContext";

export default async function OnboardingPage() {
    const { workspaceId } = await requireSessionPermission("read");
    const checklist = await getOnboardingChecklist(workspaceId);

    return (
        <section className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Onboarding Checklist</h1>
                <p className="text-sm text-slate-500">Progress setup tenant dari koneksi WA sampai go-live.</p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-800">
                        Progress: {checklist.completed}/{checklist.total} langkah selesai
                    </p>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                        {checklist.progress}%
                    </span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-slate-100">
                    <div
                        className="h-2 rounded-full bg-emerald-500"
                        style={{ width: `${checklist.progress}%` }}
                    />
                </div>

                <div className="mt-4 space-y-2">
                    {checklist.items.map((item) => (
                        <div key={item.key} className="rounded-md border border-slate-200 p-3">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                                <span
                                    className={`rounded-full px-2 py-1 text-xs ${
                                        item.done
                                            ? "bg-emerald-100 text-emerald-700"
                                            : "bg-amber-100 text-amber-700"
                                    }`}
                                >
                                    {item.done ? "Done" : "Pending"}
                                </span>
                            </div>
                            <p className="mt-1 text-sm text-slate-600">{item.description}</p>
                        </div>
                    ))}
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Quick Links</h2>
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                    <Link href="/qr" className="rounded-md border border-slate-300 px-3 py-2 text-slate-700 hover:bg-slate-50">
                        Connect WA
                    </Link>
                    <Link href="/config" className="rounded-md border border-slate-300 px-3 py-2 text-slate-700 hover:bg-slate-50">
                        Set Persona
                    </Link>
                    <Link href="/conversations" className="rounded-md border border-slate-300 px-3 py-2 text-slate-700 hover:bg-slate-50">
                        Test Message
                    </Link>
                </div>
            </div>
        </section>
    );
}
