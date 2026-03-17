import { logWarn } from "@/lib/observability/logger";
import { getInstagramIntegrationConfig } from "./config";

export type InstagramTokenResult = {
    accessToken: string;
    tokenType?: string;
    expiresIn?: number;
};

export type InstagramGraphBinding = {
    pageId: string;
    pageName?: string;
    instagramAccountId: string;
    instagramUsername?: string;
    appScopedUserId?: string;
};

type GraphRequestInput = {
    path: string;
    params?: Record<string, string>;
    method?: "GET" | "POST";
};

function getGraphBaseUrl(): string {
    const config = getInstagramIntegrationConfig();
    const version = config?.graphApiVersion || "v23.0";
    return `https://graph.facebook.com/${version}`;
}

function toQuery(params: Record<string, string | undefined>): string {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (!value) continue;
        searchParams.set(key, value);
    }
    return searchParams.toString();
}

async function requestGraphJson<T>(input: GraphRequestInput): Promise<T> {
    const url = new URL(`${getGraphBaseUrl()}${input.path}`);
    for (const [key, value] of Object.entries(input.params || {})) {
        if (!value) continue;
        url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
        method: input.method || "GET",
        headers: {
            Accept: "application/json",
        },
        cache: "no-store",
    });

    let payload: Record<string, unknown> = {};
    try {
        payload = await response.json() as Record<string, unknown>;
    } catch {
        payload = {};
    }

    if (!response.ok || payload.error) {
        const errorPayload = (payload.error || payload) as Record<string, unknown>;
        const code = typeof errorPayload.code === "number" ? errorPayload.code : undefined;
        const message = typeof errorPayload.message === "string"
            ? errorPayload.message
            : `Meta Graph API request failed: ${response.status}`;
        const type = typeof errorPayload.type === "string" ? errorPayload.type : undefined;
        const traceId = typeof errorPayload.fbtrace_id === "string" ? errorPayload.fbtrace_id : undefined;

        const err = new Error(message) as Error & {
            status?: number;
            code?: number;
            type?: string;
            traceId?: string;
        };
        err.status = response.status;
        err.code = code;
        err.type = type;
        err.traceId = traceId;
        throw err;
    }

    return payload as T;
}

function pickString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pickNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function buildInstagramOauthUrl(input: {
    state: string;
    redirectUri: string;
}): string {
    const config = getInstagramIntegrationConfig();
    if (!config) {
        throw new Error("Instagram integration is not configured");
    }

    const authorizeUrl = new URL("https://www.facebook.com/dialog/oauth");
    authorizeUrl.search = toQuery({
        client_id: config.appId,
        redirect_uri: input.redirectUri,
        state: input.state,
        response_type: "code",
        scope: config.oauthScopes.join(","),
    });

    return authorizeUrl.toString();
}

export async function exchangeCodeForUserToken(input: {
    code: string;
    redirectUri: string;
}): Promise<InstagramTokenResult> {
    const config = getInstagramIntegrationConfig();
    if (!config) {
        throw new Error("Instagram integration is not configured");
    }

    const payload = await requestGraphJson<Record<string, unknown>>({
        path: "/oauth/access_token",
        params: {
            client_id: config.appId,
            client_secret: config.appSecret,
            redirect_uri: input.redirectUri,
            code: input.code,
        },
    });

    const accessToken = pickString(payload.access_token);
    if (!accessToken) {
        throw new Error("Meta OAuth response missing access_token");
    }

    return {
        accessToken,
        tokenType: pickString(payload.token_type),
        expiresIn: pickNumber(payload.expires_in),
    };
}

export async function exchangeLongLivedUserToken(accessToken: string): Promise<InstagramTokenResult> {
    const config = getInstagramIntegrationConfig();
    if (!config) {
        throw new Error("Instagram integration is not configured");
    }

    const payload = await requestGraphJson<Record<string, unknown>>({
        path: "/oauth/access_token",
        params: {
            grant_type: "fb_exchange_token",
            client_id: config.appId,
            client_secret: config.appSecret,
            fb_exchange_token: accessToken,
        },
    });

    const refreshedToken = pickString(payload.access_token);
    if (!refreshedToken) {
        throw new Error("Meta long-lived token response missing access_token");
    }

    return {
        accessToken: refreshedToken,
        tokenType: pickString(payload.token_type),
        expiresIn: pickNumber(payload.expires_in),
    };
}

export async function fetchInstagramGraphBinding(input: {
    accessToken: string;
    preferredInstagramAccountId?: string;
}): Promise<InstagramGraphBinding> {
    const [accountsPayload, mePayload] = await Promise.all([
        requestGraphJson<Record<string, unknown>>({
            path: "/me/accounts",
            params: {
                fields: "id,name,instagram_business_account{id,username}",
                access_token: input.accessToken,
            },
        }),
        requestGraphJson<Record<string, unknown>>({
            path: "/me",
            params: {
                fields: "id,name",
                access_token: input.accessToken,
            },
        }).catch((error) => {
            logWarn("instagram.oauth.fetch_me.failed", {
                reason: error instanceof Error ? error.message : String(error),
            });
            return {} as Record<string, unknown>;
        }),
    ]);

    const appScopedUserId = pickString(mePayload.id);
    const preferred = input.preferredInstagramAccountId?.trim();
    const rows = Array.isArray(accountsPayload.data)
        ? accountsPayload.data.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        : [];

    for (const row of rows) {
        const pageId = pickString(row.id);
        const pageName = pickString(row.name);
        const ig = row.instagram_business_account;
        const igObj = ig && typeof ig === "object" ? ig as Record<string, unknown> : null;
        const instagramAccountId = igObj ? pickString(igObj.id) : undefined;
        if (!pageId || !instagramAccountId) continue;

        if (preferred && instagramAccountId !== preferred) {
            continue;
        }

        return {
            pageId,
            pageName,
            instagramAccountId,
            instagramUsername: igObj ? pickString(igObj.username) : undefined,
            appScopedUserId,
        };
    }

    if (preferred) {
        throw new Error(`Instagram account ${preferred} is not accessible for authorized user`);
    }

    throw new Error("No Instagram business account found in authorized Meta pages");
}

export function computeTokenExpiryIso(expiresIn?: number): string | undefined {
    if (!expiresIn || !Number.isFinite(expiresIn)) {
        return undefined;
    }

    return new Date(Date.now() + Math.max(0, Math.round(expiresIn)) * 1000).toISOString();
}

export function isMetaTokenInvalidError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const enriched = error as Error & { status?: number; code?: number };
    if (enriched.status === 401 || enriched.status === 403) {
        return true;
    }

    return enriched.code === 190;
}

