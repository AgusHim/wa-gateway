const DEFAULT_GRAPH_API_VERSION = "v23.0";
export const DEFAULT_INSTAGRAM_OAUTH_SCOPES = [
    "instagram_basic",
    "instagram_manage_messages",
    "instagram_manage_comments",
    "pages_show_list",
    "pages_read_engagement",
] as const;

function readStringEnv(name: string): string | null {
    const value = process.env[name];
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim();
    return normalized || null;
}

export type InstagramIntegrationConfig = {
    appId: string;
    appSecret: string;
    graphApiVersion: string;
    oauthScopes: string[];
    redirectUriOverride?: string;
};

export function getInstagramIntegrationConfig(): InstagramIntegrationConfig | null {
    const appId = readStringEnv("INSTAGRAM_APP_ID");
    const appSecret = readStringEnv("INSTAGRAM_APP_SECRET");

    if (!appId || !appSecret) {
        return null;
    }

    const graphApiVersion = readStringEnv("INSTAGRAM_GRAPH_API_VERSION") || DEFAULT_GRAPH_API_VERSION;
    const scopesRaw = readStringEnv("INSTAGRAM_OAUTH_SCOPES")
        || DEFAULT_INSTAGRAM_OAUTH_SCOPES.join(",");
    const oauthScopes = Array.from(new Set(scopesRaw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)));
    const redirectUriOverride = readStringEnv("INSTAGRAM_REDIRECT_URI") || undefined;

    return {
        appId,
        appSecret,
        graphApiVersion,
        oauthScopes,
        redirectUriOverride,
    };
}

export function resolveAppBaseUrl(fallbackOrigin?: string): string {
    const fromEnv = readStringEnv("NEXTAUTH_URL") || readStringEnv("NEXT_PUBLIC_APP_URL");
    const origin = fromEnv || fallbackOrigin || "http://localhost:3000";

    try {
        const parsed = new URL(origin);
        parsed.pathname = "";
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString().replace(/\/$/, "");
    } catch {
        return "http://localhost:3000";
    }
}
