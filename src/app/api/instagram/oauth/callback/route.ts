import { NextRequest, NextResponse } from "next/server";
import { completeInstagramOauth } from "@/lib/integrations/instagram/service";
import { resolveAppBaseUrl } from "@/lib/integrations/instagram/config";
import { logError } from "@/lib/observability/logger";

export const runtime = "nodejs";

function safeMessage(value: unknown): string {
    const raw = value instanceof Error ? value.message : String(value || "");
    return raw.trim().slice(0, 180);
}

function buildRedirect(input: {
    origin: string;
    path: string;
    status: "success" | "error";
    channelId?: string;
    message?: string;
}) {
    const base = resolveAppBaseUrl(input.origin);
    const url = new URL(input.path, `${base}/`);
    url.searchParams.set("instagram_oauth", input.status);
    if (input.channelId) {
        url.searchParams.set("channelId", input.channelId);
    }
    if (input.message) {
        url.searchParams.set("message", input.message);
    }
    return url;
}

export async function GET(request: NextRequest) {
    const code = request.nextUrl.searchParams.get("code")?.trim();
    const state = request.nextUrl.searchParams.get("state")?.trim();
    const errorReason = request.nextUrl.searchParams.get("error_description")
        || request.nextUrl.searchParams.get("error")
        || "";

    if (errorReason) {
        return NextResponse.redirect(buildRedirect({
            origin: request.nextUrl.origin,
            path: "/channels",
            status: "error",
            message: safeMessage(errorReason),
        }));
    }

    if (!code || !state) {
        return NextResponse.redirect(buildRedirect({
            origin: request.nextUrl.origin,
            path: "/channels",
            status: "error",
            message: "Missing OAuth code/state",
        }));
    }

    try {
        const result = await completeInstagramOauth({
            code,
            state,
            fallbackOrigin: request.nextUrl.origin,
        });

        return NextResponse.redirect(buildRedirect({
            origin: request.nextUrl.origin,
            path: result.returnPath,
            status: "success",
            channelId: result.channelId,
        }));
    } catch (error) {
        logError("instagram.oauth.callback_failed", error, {
            codePreview: code.slice(0, 8),
        });
        return NextResponse.redirect(buildRedirect({
            origin: request.nextUrl.origin,
            path: "/channels",
            status: "error",
            message: safeMessage(error),
        }));
    }
}

