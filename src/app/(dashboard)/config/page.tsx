import { configRepo } from "@/lib/db/configRepo";
import { getInstructionFiles, loadInstruction } from "@/lib/instructions/loader";
import { saveInstructionAction, updateBotConfigAction } from "../actions";

export default async function ConfigPage() {
    const [botConfig, instructionFiles] = await Promise.all([
        configRepo.getBotConfig(),
        Promise.resolve(getInstructionFiles()),
    ]);

    return (
        <section className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">Config</h1>
                <p className="text-sm text-slate-500">Kelola instruction markdown dan bot runtime config.</p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">BotConfig</h2>
                <form action={updateBotConfigAction} className="mt-3 grid gap-3 md:grid-cols-4">
                    <select
                        name="isActive"
                        defaultValue={botConfig.isActive ? "true" : "false"}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                        <option value="true">Aktif</option>
                        <option value="false">Nonaktif</option>
                    </select>
                    <input
                        name="model"
                        defaultValue={botConfig.model}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                        type="number"
                        min={128}
                        max={8192}
                        name="maxTokens"
                        defaultValue={botConfig.maxTokens}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                        Save BotConfig
                    </button>
                </form>
            </div>

            <div className="space-y-4">
                {instructionFiles.map((fileName) => (
                    <form key={fileName} action={saveInstructionAction} className="rounded-lg border border-slate-200 bg-white p-4">
                        <div className="mb-2 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-slate-800">{fileName}</h3>
                            <button
                                type="submit"
                                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
                            >
                                Save & Reload
                            </button>
                        </div>
                        <input type="hidden" name="fileName" value={fileName} />
                        <textarea
                            name="content"
                            defaultValue={loadInstruction(fileName)}
                            className="h-64 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                    </form>
                ))}
            </div>
        </section>
    );
}
