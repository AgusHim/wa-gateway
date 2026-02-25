import { connectToWhatsApp } from "../lib/baileys/client";
import { startWorker } from "../lib/queue/worker";
import { initializeTools } from "./tools/init";
import { runAgent } from "./runner";
import { sendMessage, sendOperatorReport } from "../lib/baileys/client";
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
            console.log(`[Bootstrap] Running agent for ${phoneNumber}, text="${messageText.slice(0, 120)}"`);
            // Run the AI agent
            const response = await runAgent(phoneNumber, messageText, pushName);
            console.log(`[Bootstrap] Agent response for ${phoneNumber}: "${response.slice(0, 200)}"`);

            // Send response back via WhatsApp
            if (response) {
                await sendMessage(phoneNumber, response);
                console.log(`[Bootstrap] Message sent to ${phoneNumber}`);
            }
        } catch (error) {
            console.error(`[Bootstrap] Error processing message from ${phoneNumber}:`, error);

            // Do not send failure response to user.
            // Send internal report only to the WhatsApp account connected in Baileys.
            const errText = error instanceof Error ? error.message : String(error);
            try {
                await sendOperatorReport(
                    `[Gateway Error]\nFrom: ${phoneNumber}\nMessage: ${messageText.slice(0, 200)}\nError: ${errText}`
                );
            } catch (reportErr) {
                console.error("[Bootstrap] Failed to send operator error report:", reportErr);
            }

            // Re-throw so BullMQ marks job as failed instead of completed.
            throw error;
        }
    });

    // 4. Connect to WhatsApp
    await connectToWhatsApp();

    console.log("✅ WhatsApp AI Agent Gateway is ready!");
}
