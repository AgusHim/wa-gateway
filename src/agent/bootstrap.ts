import { connectToWhatsApp } from "../lib/baileys/client";
import { startWorker } from "../lib/queue/worker";
import { initializeTools } from "./tools/init";
import { runAgent } from "./runner";
import { sendMessage } from "../lib/baileys/client";
import { Job } from "bullmq";
import { InboundMessageJob } from "../lib/queue/messageQueue";
import { loadAllInstructions } from "../lib/instructions/loader";

/**
 * Bootstrap the entire agent system.
 * Call this once at app startup.
 */
export async function bootstrap(): Promise<void> {
    console.log("🚀 Starting WhatsApp AI Agent Gateway...");

    // 1. Pre-load instruction files
    loadAllInstructions();
    console.log("📝 Instructions loaded");

    // 2. Initialize tools
    initializeTools();

    // 3. Start queue worker
    startWorker(async (job: Job<InboundMessageJob>) => {
        const { phoneNumber, messageText, pushName } = job.data;

        try {
            // Run the AI agent
            const response = await runAgent(phoneNumber, messageText, pushName);

            // Send response back via WhatsApp
            if (response) {
                await sendMessage(phoneNumber, response);
            }
        } catch (error) {
            console.error(`[Bootstrap] Error processing message from ${phoneNumber}:`, error);

            // Send fallback message
            try {
                await sendMessage(
                    phoneNumber,
                    "Maaf, terjadi kesalahan saat memproses pesanmu. Coba lagi nanti ya 🙏"
                );
            } catch {
                console.error("[Bootstrap] Failed to send fallback message");
            }
        }
    });

    // 4. Connect to WhatsApp
    await connectToWhatsApp();

    console.log("✅ WhatsApp AI Agent Gateway is ready!");
}
