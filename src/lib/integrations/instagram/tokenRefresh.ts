import { channelRepo } from "@/lib/db/channelRepo";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import { instagramRepo } from "./repo";
import { refreshInstagramChannelToken, syncInstagramChannelHealth } from "./service";

let refreshTimer: NodeJS.Timeout | null = null;

function parseIntEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(1, Math.round(parsed));
}

function resolveRefreshThresholdMs(): number {
    const hours = parseIntEnv("INSTAGRAM_TOKEN_REFRESH_THRESHOLD_HOURS", 24 * 5);
    return hours * 60 * 60 * 1000;
}

function resolveRefreshIntervalMs(): number {
    const minutes = parseIntEnv("INSTAGRAM_TOKEN_REFRESH_INTERVAL_MINUTES", 30);
    return Math.max(5, minutes) * 60 * 1000;
}

async function runRefreshCycle() {
    const thresholdDate = new Date(Date.now() + resolveRefreshThresholdMs());
    const expiring = await instagramRepo.listExpiringCredentials(thresholdDate);
    if (expiring.length === 0) {
        return;
    }

    for (const item of expiring) {
        try {
            await refreshInstagramChannelToken({
                workspaceId: item.workspaceId,
                channelId: item.channelId,
                triggeredBy: "scheduler",
            });
        } catch (error) {
            logWarn("instagram.token_scheduler.refresh_failed", {
                workspaceId: item.workspaceId,
                channelId: item.channelId,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

async function warmupHealthState() {
    const channels = await channelRepo.listActiveRuntimeChannels("instagram");
    for (const channel of channels) {
        try {
            await syncInstagramChannelHealth(channel.workspaceId, channel.id);
        } catch (error) {
            logWarn("instagram.token_scheduler.health_sync_failed", {
                workspaceId: channel.workspaceId,
                channelId: channel.id,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

export async function startInstagramTokenRefreshScheduler() {
    if (refreshTimer) {
        return;
    }

    const intervalMs = resolveRefreshIntervalMs();
    await warmupHealthState().catch((error) => {
        logError("instagram.token_scheduler.warmup_failed", error);
    });

    refreshTimer = setInterval(() => {
        void runRefreshCycle().catch((error) => {
            logError("instagram.token_scheduler.cycle_failed", error);
        });
    }, intervalMs);
    refreshTimer.unref?.();

    logInfo("instagram.token_scheduler.started", {
        intervalMs,
        refreshThresholdMs: resolveRefreshThresholdMs(),
    });
}

