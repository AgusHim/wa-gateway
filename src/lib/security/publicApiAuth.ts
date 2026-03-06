import { NextRequest, NextResponse } from "next/server";
import { workspaceApiKeyRepo } from "@/lib/db/workspaceApiKeyRepo";

export type PublicApiContext = {
    workspaceId: string;
    apiKeyId: string;
    scopes: string[];
};

type PublicAuthSuccess = {
    ok: true;
    context: PublicApiContext;
};

type PublicAuthFailure = {
    ok: false;
    response: NextResponse;
};

export type PublicAuthResult = PublicAuthSuccess | PublicAuthFailure;

function extractRawApiKey(request: NextRequest): string {
    const headerKey = request.headers.get("x-api-key")?.trim() || "";
    if (headerKey) {
        return headerKey;
    }

    const authHeader = request.headers.get("authorization")?.trim() || "";
    if (authHeader.toLowerCase().startsWith("bearer ")) {
        return authHeader.slice(7).trim();
    }

    return "";
}

function isApiKeyPrefixOnly(rawApiKey: string): boolean {
    const value = rawApiKey.trim();
    if (!value.startsWith("wgk_")) return false;
    return value.split("_").length === 2;
}

export async function requirePublicApiKey(
    request: NextRequest,
    requiredScopes: string[] = []
): Promise<PublicAuthResult> {
    const rawApiKey = extractRawApiKey(request);
    if (!rawApiKey) {
        return {
            ok: false,
            response: NextResponse.json(
                {
                    success: false,
                    message: "Unauthorized: missing API key",
                },
                { status: 401 }
            ),
        };
    }

    if (isApiKeyPrefixOnly(rawApiKey)) {
        return {
            ok: false,
            response: NextResponse.json(
                {
                    success: false,
                    message: "Unauthorized: API key prefix detected. Use full key from create/rotate result.",
                },
                { status: 401 }
            ),
        };
    }

    const authResult = await workspaceApiKeyRepo.authenticate(rawApiKey, requiredScopes);
    if (!authResult) {
        return {
            ok: false,
            response: NextResponse.json(
                {
                    success: false,
                    message: "Unauthorized: invalid API key",
                },
                { status: 401 }
            ),
        };
    }

    if (!authResult.ok) {
        return {
            ok: false,
            response: NextResponse.json(
                {
                    success: false,
                    message: "Forbidden: insufficient scope",
                },
                { status: 403 }
            ),
        };
    }

    return {
        ok: true,
        context: {
            workspaceId: authResult.key.workspaceId,
            apiKeyId: authResult.key.id,
            scopes: authResult.key.scopes,
        },
    };
}
