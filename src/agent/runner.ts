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
    if (!normalized) return false;
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
        const [
            { configRepo },
            { messageRepo },
            { userRepo },
            { handoverRepo },
            { detectHumanHandoverTopic },
            { sendOperatorReport },
        ] = await Promise.all([
            import("../lib/db/configRepo"),
            import("../lib/db/messageRepo"),
            import("../lib/db/userRepo"),
            import("../lib/handover/repo"),
            import("../lib/handover/topicGuard"),
            import("../lib/baileys/client"),
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

        if (await handoverRepo.isPending(phoneNumber)) {
            return "";
        }

        const handoverMatch = detectHumanHandoverTopic(incomingMessage);
        if (handoverMatch.requiresHuman) {
            await handoverRepo.markPending({
                phoneNumber,
                topic: handoverMatch.topic,
                keyword: handoverMatch.keyword,
                lastUserMessage: incomingMessage.slice(0, 500),
            });

            await messageRepo.saveMessage({
                userId: user.id,
                role: "system",
                content: `[Handover] User membutuhkan bantuan agent manusia. Topik: ${handoverMatch.topic || "unknown"}`,
                metadata: {
                    source: "human-handover",
                    topic: handoverMatch.topic,
                    keyword: handoverMatch.keyword,
                },
            });

            try {
                await sendOperatorReport(
                    `[Human Handover]\nPhone: ${phoneNumber}\nName: ${pushName || "-"}\nTopic: ${handoverMatch.topic || "-"}\nKeyword: ${handoverMatch.keyword || "-"}\nMessage: ${incomingMessage.slice(0, 300)}`
                );
            } catch (error) {
                console.warn("[Runner] Failed to send handover report:", error);
            }

            return "";
        }

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
