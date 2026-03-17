export type InstagramAppMode = "live" | "development";

export type InstagramLaunchModeSnapshot = {
    appMode: InstagramAppMode;
    fallbackActive: boolean;
    workspaceAllowed: boolean;
    allowedWorkspaceIds: string[];
    message?: string;
};

function readStringEnv(name: string): string {
    return typeof process.env[name] === "string" ? process.env[name].trim() : "";
}

function parseWorkspaceAllowlist(): string[] {
    const raw = readStringEnv("INSTAGRAM_DEV_MODE_ALLOWED_WORKSPACES");
    if (!raw) {
        return [];
    }

    return Array.from(new Set(raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)));
}

export function resolveInstagramAppMode(): InstagramAppMode {
    return readStringEnv("INSTAGRAM_APP_MODE").toLowerCase() === "development"
        ? "development"
        : "live";
}

export function resolveInstagramLaunchMode(workspaceId?: string | null): InstagramLaunchModeSnapshot {
    const appMode = resolveInstagramAppMode();
    const allowedWorkspaceIds = parseWorkspaceAllowlist();
    const normalizedWorkspaceId = workspaceId?.trim() || "";
    const workspaceAllowed = appMode === "live"
        || !normalizedWorkspaceId
        || allowedWorkspaceIds.includes(normalizedWorkspaceId);
    const fallbackActive = appMode === "development" && !workspaceAllowed;

    return {
        appMode,
        fallbackActive,
        workspaceAllowed,
        allowedWorkspaceIds,
        message: fallbackActive
            ? "Instagram app masih development mode. Gunakan workspace pilot/sandbox yang diallowlist sebelum rollout tenant lain."
            : undefined,
    };
}

export function assertInstagramLaunchModeAllowsWorkspace(workspaceId: string): void {
    const snapshot = resolveInstagramLaunchMode(workspaceId);
    if (snapshot.fallbackActive) {
        throw new Error(snapshot.message || "Instagram app development mode fallback is active");
    }
}
