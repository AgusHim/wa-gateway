export type WorkerRuntimeSnapshot = {
    workerType: "whatsapp-inbound" | "whatsapp-outbound" | "instagram-webhook";
    queueName: string;
    concurrency: number;
    minConcurrency: number;
    maxConcurrency: number;
    targetBacklog: number;
    intervalMs: number;
    lastBacklog: number;
    updatedAt: number;
};

const globalForWorkerRuntime = globalThis as typeof globalThis & {
    __waGatewayWorkerRuntimeSnapshots?: Map<string, WorkerRuntimeSnapshot>;
};

const workerRuntimeSnapshots = globalForWorkerRuntime.__waGatewayWorkerRuntimeSnapshots
    || new Map<string, WorkerRuntimeSnapshot>();

if (!globalForWorkerRuntime.__waGatewayWorkerRuntimeSnapshots) {
    globalForWorkerRuntime.__waGatewayWorkerRuntimeSnapshots = workerRuntimeSnapshots;
}

export function upsertWorkerRuntimeSnapshot(snapshot: WorkerRuntimeSnapshot) {
    workerRuntimeSnapshots.set(snapshot.queueName, snapshot);
}

export function listWorkerRuntimeSnapshots() {
    return Array.from(workerRuntimeSnapshots.values())
        .sort((a, b) => a.queueName.localeCompare(b.queueName));
}
