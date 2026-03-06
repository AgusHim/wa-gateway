import { prisma } from "@/lib/db/client";
import { configRepo } from "@/lib/db/configRepo";
import { sessionRepo } from "@/lib/db/sessionRepo";

const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_MAX_TOKENS = 1024;

export type OnboardingChecklistItem = {
    key: "connect_wa" | "set_persona" | "test_message" | "go_live";
    title: string;
    description: string;
    done: boolean;
};

export type OnboardingChecklist = {
    completed: number;
    total: number;
    progress: number;
    items: OnboardingChecklistItem[];
};

export async function getOnboardingChecklist(workspaceId: string): Promise<OnboardingChecklist> {
    const sessionId = process.env.WA_SESSION_ID || "main-session";
    const [connectionStatus, botConfig, userMessages, assistantMessages] = await Promise.all([
        sessionRepo.getSession(`${sessionId}:connection-status`),
        configRepo.getBotConfig(workspaceId),
        prisma.message.count({
            where: {
                workspaceId,
                role: "user",
            },
        }),
        prisma.message.count({
            where: {
                workspaceId,
                role: "assistant",
            },
        }),
    ]);

    const connectWa = connectionStatus?.data === "open";
    const setPersona = botConfig.model !== DEFAULT_MODEL || botConfig.maxTokens !== DEFAULT_MAX_TOKENS;
    const testMessage = userMessages > 0 && assistantMessages > 0;
    const goLive = botConfig.isActive && connectWa;

    const items: OnboardingChecklistItem[] = [
        {
            key: "connect_wa",
            title: "Connect WhatsApp",
            description: "Scan QR dan pastikan status koneksi WA menjadi connected.",
            done: connectWa,
        },
        {
            key: "set_persona",
            title: "Set Persona Bot",
            description: "Atur model atau token limit bot sesuai kebutuhan bisnis.",
            done: setPersona,
        },
        {
            key: "test_message",
            title: "Test Message",
            description: "Lakukan percobaan chat hingga ada alur user dan assistant.",
            done: testMessage,
        },
        {
            key: "go_live",
            title: "Go-Live",
            description: "Aktifkan bot agar siap merespons percakapan produksi.",
            done: goLive,
        },
    ];

    const completed = items.filter((item) => item.done).length;
    const total = items.length;
    const progress = total === 0 ? 0 : Math.round((completed / total) * 100);

    return {
        completed,
        total,
        progress,
        items,
    };
}
