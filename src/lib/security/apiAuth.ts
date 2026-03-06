import { NextRequest } from "next/server";
import { sessionRepo } from "@/lib/db/sessionRepo";

const DB_AUTH_SESSION_KEY = process.env.WA_AUTH_DB_SESSION_KEY || "wa-api-auth";

type ApiAuthUser = {
    id: string;
    name?: string;
    apiKey?: string;
    bearerToken?: string;
    isActive?: boolean;
    scopes?: string[];
};

type ApiAuthConfig = {
    users: ApiAuthUser[];
};

type AuthenticatedPrincipal = {
    id: string;
    name?: string;
    source: "db" | "env" | "anonymous";
};

type AuthResult =
    | {
        ok: true;
        principal: AuthenticatedPrincipal;
    }
    | {
        ok: false;
        status: 401 | 403;
        message: string;
    };

function safeString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function hasRequiredScopes(userScopes: string[] | undefined, requiredScopes: string[]): boolean {
    if (requiredScopes.length === 0) return true;
    if (!userScopes || userScopes.length === 0) return true;
    if (userScopes.includes("*")) return true;
    return requiredScopes.every((scope) => userScopes.includes(scope));
}

function parseAuthConfig(raw: string): ApiAuthConfig | null {
    try {
        const parsed = JSON.parse(raw) as { users?: unknown };
        if (!parsed || !Array.isArray(parsed.users)) return null;

        const users: ApiAuthUser[] = [];
        for (const item of parsed.users) {
            const row = item as Record<string, unknown>;
            const id = safeString(row.id);
            if (!id) continue;

            const user: ApiAuthUser = {
                id,
                isActive: typeof row.isActive === "boolean" ? row.isActive : true,
            };

            const name = safeString(row.name);
            if (name) user.name = name;

            const apiKey = safeString(row.apiKey);
            if (apiKey) user.apiKey = apiKey;

            const bearerToken = safeString(row.bearerToken);
            if (bearerToken) user.bearerToken = bearerToken;

            if (Array.isArray(row.scopes)) {
                user.scopes = row.scopes.filter((scope): scope is string => typeof scope === "string");
            }

            users.push(user);
        }

        return { users };
    } catch {
        return null;
    }
}

function extractCredentials(request: NextRequest): { apiKey: string; bearer: string } {
    const apiKey = safeString(request.headers.get("x-api-key"));
    const authHeader = safeString(request.headers.get("authorization"));
    const bearer = authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : "";

    return { apiKey, bearer };
}

export async function authenticateApiRequest(
    request: NextRequest,
    options?: { requiredScopes?: string[]; allowAnonymous?: boolean }
): Promise<AuthResult> {
    const requiredScopes = options?.requiredScopes ?? [];
    const allowAnonymous = options?.allowAnonymous ?? true;
    const { apiKey, bearer } = extractCredentials(request);
    const dbSession = await sessionRepo.getSession(DB_AUTH_SESSION_KEY);
    const dbConfig = dbSession?.data ? parseAuthConfig(dbSession.data) : null;
    const dbUsers = (dbConfig?.users ?? []).filter((user) => user.isActive !== false);

    for (const user of dbUsers) {
        const byApiKey = Boolean(apiKey) && user.apiKey === apiKey;
        const byBearer = Boolean(bearer) && user.bearerToken === bearer;
        if (!byApiKey && !byBearer) continue;

        if (!hasRequiredScopes(user.scopes, requiredScopes)) {
            return {
                ok: false,
                status: 403,
                message: "Forbidden: insufficient scope",
            };
        }

        return {
            ok: true,
            principal: {
                id: user.id,
                name: user.name,
                source: "db",
            },
        };
    }

    const envApiKey = safeString(process.env.WA_GATEWAY_API_KEY);
    if (envApiKey) {
        if (apiKey === envApiKey || bearer === envApiKey) {
            return {
                ok: true,
                principal: {
                    id: "env-api-key",
                    source: "env",
                },
            };
        }

        return {
            ok: false,
            status: 401,
            message: "Unauthorized",
        };
    }

    if (dbUsers.length > 0) {
        return {
            ok: false,
            status: 401,
            message: "Unauthorized",
        };
    }

    if (!allowAnonymous) {
        return {
            ok: false,
            status: 401,
            message: "Unauthorized: auth is not configured",
        };
    }

    return {
        ok: true,
        principal: {
            id: "anonymous",
            source: "anonymous",
        },
    };
}

export function getDbAuthSessionKey() {
    return DB_AUTH_SESSION_KEY;
}
