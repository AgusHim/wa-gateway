import { Message } from "@prisma/client";

const KNOWN_FALLBACK_MARKERS = [
    "Maaf, terjadi kesalahan saat memproses pesan kamu.",
    "Maaf, sistem sedang mengalami kendala.",
];

function isFallbackAssistantMessage(role: string, content: string): boolean {
    if (role !== "assistant") return false;
    const normalized = content.trim();
    return KNOWN_FALLBACK_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * Format recent chat history into messages for the AI context window.
 */
export function buildHistoryMessages(messages: Message[]): Array<{
    role: "user" | "assistant";
    content: string;
}> {
    return messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .filter((m) => !isFallbackAssistantMessage(m.role, m.content))
        .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
        }));
}
