import { Queue } from "bullmq";
import { redis } from "./client";

export interface InboundMessageJob {
    phoneNumber: string;
    messageText: string;
    messageId: string;
    timestamp: number;
    pushName?: string;
}

export const messageQueue = new Queue<InboundMessageJob>("whatsapp-inbound", {
    connection: redis,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
    },
});
