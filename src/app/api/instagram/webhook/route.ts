import { NextRequest, NextResponse } from "next/server";
import { ingestInstagramWebhookPayload } from "@/lib/integrations/instagram/webhookIngestion";
import { verifyInstagramWebhookSignature } from "@/lib/integrations/instagram/webhook";
import { withObservationContext } from "@/lib/observability/context";
import { logInfo, logWarn } from "@/lib/observability/logger";
import { generateCorrelationId, generateTraceId } from "@/lib/observability/trace";

export const runtime = "nodejs";

function readString(value: string | null): string {
    return value?.trim() || "";
}

function getWebhookVerifyToken(): string {
    return readString(process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || null);
}

function getInstagramAppSecret(): string {
    return readString(process.env.INSTAGRAM_APP_SECRET || null);
}

export async function GET(request: NextRequest) {
    const mode = readString(request.nextUrl.searchParams.get("hub.mode"));
    const verifyToken = readString(request.nextUrl.searchParams.get("hub.verify_token"));
    const challenge = request.nextUrl.searchParams.get("hub.challenge") || "";

    const expectedToken = getWebhookVerifyToken();
    if (!expectedToken) {
        return NextResponse.json(
            {
                success: false,
                message: "Instagram webhook verify token is not configured",
            },
            { status: 503 }
        );
    }

    if (mode !== "subscribe" || !challenge || verifyToken !== expectedToken) {
        return NextResponse.json(
            {
                success: false,
                message: "Webhook verification failed",
            },
            { status: 403 }
        );
    }

    return new NextResponse(challenge, {
        status: 200,
        headers: {
            "content-type": "text/plain",
            "cache-control": "no-store",
        },
    });
}

export async function POST(request: NextRequest) {
    return withObservationContext({
        component: "instagram-webhook-route",
        provider: "instagram",
        traceId: generateTraceId(),
        correlationId: generateCorrelationId(),
    }, async () => {
        const receivedAt = Date.now();
        const rawBody = await request.text();

        if (!rawBody.trim()) {
            return NextResponse.json({ success: true, accepted: 0, message: "empty payload" });
        }

        const appSecret = getInstagramAppSecret();
        const signature = readString(request.headers.get("x-hub-signature-256"));
        if (appSecret) {
            if (!signature) {
                return NextResponse.json(
                    {
                        success: false,
                        message: "Missing X-Hub-Signature-256 header",
                    },
                    { status: 401 }
                );
            }

            const signatureValid = verifyInstagramWebhookSignature({
                appSecret,
                rawBody,
                signatureHeader: signature,
            });
            if (!signatureValid) {
                return NextResponse.json(
                    {
                        success: false,
                        message: "Invalid webhook signature",
                    },
                    { status: 401 }
                );
            }
        }

        let payload: unknown;
        try {
            payload = JSON.parse(rawBody);
        } catch {
            return NextResponse.json(
                {
                    success: false,
                    message: "Invalid JSON payload",
                },
                { status: 400 }
            );
        }

        try {
            const result = await ingestInstagramWebhookPayload({
                payload,
                receivedAt,
            });
            logInfo("instagram.webhook.ingested", result);

            return NextResponse.json({
                success: true,
                data: result,
            });
        } catch (error) {
            logWarn("instagram.webhook.ingestion_failed", {
                reason: error instanceof Error ? error.message : String(error),
            });

            // Do not trigger repeated retries from Meta for transient internal errors.
            return NextResponse.json({
                success: true,
                data: {
                    received: 1,
                    normalized: 0,
                    accepted: 0,
                    duplicates: 0,
                    skipped: 1,
                },
            });
        }
    });
}
