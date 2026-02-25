import { Message } from "@prisma/client";

/**
 * Format recent chat history into messages for the AI context window.
 */
export function buildHistoryMessages(messages: Message[]): Array<{
    role: "user" | "assistant";
    content: string;
}> {
    return messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
        }));
}
