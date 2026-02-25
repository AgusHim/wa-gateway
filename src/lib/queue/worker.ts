import { Worker, Job } from "bullmq";
import { redis } from "./client";
import { InboundMessageJob } from "./messageQueue";

let worker: Worker<InboundMessageJob> | null = null;

export function startWorker(
    processor: (job: Job<InboundMessageJob>) => Promise<void>
) {
    if (worker) {
        console.log("[Queue] Worker already running");
        return worker;
    }

    worker = new Worker<InboundMessageJob>(
        "whatsapp-inbound",
        async (job) => {
            console.log(`[Queue] Processing job ${job.id} from ${job.data.phoneNumber}`);
            await processor(job);
        },
        {
            connection: redis,
            concurrency: 5,
        }
    );

    worker.on("completed", (job) => {
        console.log(`[Queue] Job ${job.id} completed`);
    });

    worker.on("failed", (job, err) => {
        console.error(`[Queue] Job ${job?.id} failed:`, err.message);
    });

    worker.on("error", (err) => {
        console.error("[Queue] Worker error:", err.message);
    });

    console.log("[Queue] Worker started with concurrency 5");
    return worker;
}

export function getWorker() {
    return worker;
}
