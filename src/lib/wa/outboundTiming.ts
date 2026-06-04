import type { OutboundMode } from "./compliance";

function parseIntegerEnv(name: string, fallback: number, min: number, max: number): number {
    const parsed = Number(process.env[name]);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function getBroadcastJitterRangeMs(): { minMs: number; maxMs: number } {
    const minMs = parseIntegerEnv("WA_BROADCAST_JITTER_MIN_MS", 2000, 0, 60_000);
    const maxMs = parseIntegerEnv("WA_BROADCAST_JITTER_MAX_MS", 8000, 0, 60_000);

    return {
        minMs,
        maxMs: Math.max(minMs, maxMs),
    };
}

export function resolveOutboundJitterDelayMs(mode: OutboundMode): number {
    if (mode !== "broadcast") {
        return 0;
    }

    const { minMs, maxMs } = getBroadcastJitterRangeMs();
    if (maxMs <= minMs) {
        return minMs;
    }

    return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

export function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
