export type AgentExecutor = (
    phoneNumber: string,
    incomingMessage: string,
    pushName?: string
) => Promise<string>;

const NON_PERSISTED_ASSISTANT_MARKERS = [
    "Maaf, terjadi kesalahan saat memproses pesan kamu.",
    "Maaf, sistem sedang mengalami kendala.",
];

function shouldPersistAssistantMessage(content: string): boolean {
    const normalized = content.trim();
    return !NON_PERSISTED_ASSISTANT_MARKERS.some((marker) => normalized.includes(marker));
}

export async function runAgentWithExecutor(
    executor: AgentExecutor,
    phoneNumber: string,
    incomingMessage: string,
    pushName?: string
): Promise<string> {
    try {
        return await executor(phoneNumber, incomingMessage, pushName);
    } catch (error) {
        console.error("[Runner] Agent execution failed:", error);
        return "Maaf, sistem sedang mengalami kendala. Coba lagi sebentar ya 🙏";
    }
}

/**
 * Main runner entrypoint for inbound WhatsApp messages.
 */
export async function runAgent(
    phoneNumber: string,
    incomingMessage: string,
    pushName?: string
): Promise<string> {
    try {
        const [{ configRepo }, { messageRepo }, { userRepo }] = await Promise.all([
            import("../lib/db/configRepo"),
            import("../lib/db/messageRepo"),
            import("../lib/db/userRepo"),
        ]);

        const config = await configRepo.getBotConfig();
        if (!config.isActive) {
            return "Maaf, bot sedang tidak aktif. Silakan coba lagi nanti.";
        }

        const user = await userRepo.upsertUser(phoneNumber, pushName);
        if (user.isBlocked) {
            return "";
        }

        await messageRepo.saveMessage({
            userId: user.id,
            role: "user",
            content: incomingMessage,
        });

        const { invokeAgentGraph } = await import("./graph");
        const response = await invokeAgentGraph({
            userId: user.id,
            phoneNumber,
            incomingMessage,
            pushName,
            maxIterations: 5,
        });

        if (shouldPersistAssistantMessage(response)) {
            await messageRepo.saveMessage({
                userId: user.id,
                role: "assistant",
                content: response,
            });
        } else {
            console.warn(`[Runner] Skip persisting fallback assistant response for ${phoneNumber}`);
        }

        return response;
    } catch (error) {
        console.error("[Runner] Agent execution failed:", error);
        throw error;
    }
}
