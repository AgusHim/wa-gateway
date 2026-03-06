import { prisma } from "@/lib/db/client";

let schedulerTimer: NodeJS.Timeout | null = null;
let sweepInProgress = false;

function retentionCutoff(days: number): Date {
    const duration = Math.max(1, Math.min(3650, Math.round(days))) * 24 * 60 * 60 * 1000;
    return new Date(Date.now() - duration);
}

export async function purgeExpiredMemories(): Promise<{ workspaces: number; deleted: number }> {
    if (sweepInProgress) {
        return { workspaces: 0, deleted: 0 };
    }

    sweepInProgress = true;

    try {
        const configs = await prisma.workspaceConfig.findMany({
            select: {
                workspaceId: true,
                memoryRetentionDays: true,
            },
        });

        let deleted = 0;

        for (const config of configs) {
            const cutoff = retentionCutoff(config.memoryRetentionDays);
            const result = await prisma.memory.deleteMany({
                where: {
                    workspaceId: config.workspaceId,
                    updatedAt: { lt: cutoff },
                },
            });
            deleted += result.count;
        }

        return {
            workspaces: configs.length,
            deleted,
        };
    } finally {
        sweepInProgress = false;
    }
}

export function startMemoryRetentionScheduler(intervalMs: number = 60 * 60 * 1000): void {
    if (schedulerTimer) {
        return;
    }

    const runSweep = () => {
        purgeExpiredMemories()
            .then((result) => {
                if (result.deleted > 0) {
                    console.log(`[Memory] Retention sweep deleted ${result.deleted} rows across ${result.workspaces} workspace(s)`);
                }
            })
            .catch((error) => {
                console.error("[Memory] Retention sweep failed:", error);
            });
    };

    runSweep();
    schedulerTimer = setInterval(runSweep, Math.max(60_000, intervalMs));
}
