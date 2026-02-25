import { runAgent as runGraphAgent } from "./graph";

/**
 * Main runner entrypoint for inbound WhatsApp messages.
 */
export async function runAgent(
    phoneNumber: string,
    incomingMessage: string,
    pushName?: string
): Promise<string> {
    try {
        return await runGraphAgent(phoneNumber, incomingMessage, pushName);
    } catch (error) {
        console.error("[Runner] Agent execution failed:", error);
        return "Maaf, sistem sedang mengalami kendala. Coba lagi sebentar ya 🙏";
    }
}
