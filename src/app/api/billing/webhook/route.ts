import crypto from "crypto";
import { PaymentProvider } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { billingService } from "@/lib/billing/service";

export const runtime = "nodejs";

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeProvider(value: string): PaymentProvider {
    if (value === PaymentProvider.STRIPE) return PaymentProvider.STRIPE;
    if (value === PaymentProvider.XENDIT) return PaymentProvider.XENDIT;
    if (value === PaymentProvider.MIDTRANS) return PaymentProvider.MIDTRANS;
    return PaymentProvider.MANUAL;
}

function verifySignature(rawBody: string, signature: string | null): boolean {
    const secret = process.env.BILLING_WEBHOOK_SECRET;
    if (!secret) {
        return true;
    }

    if (!signature) {
        return false;
    }

    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    if (expected.length !== signature.length) {
        return false;
    }
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function POST(request: NextRequest) {
    const signature = request.headers.get("x-billing-signature");
    const rawBody = await request.text();

    if (!verifySignature(rawBody, signature)) {
        return NextResponse.json(
            {
                success: false,
                message: "Invalid webhook signature",
            },
            { status: 401 }
        );
    }

    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
        return NextResponse.json(
            {
                success: false,
                message: "Invalid JSON payload",
            },
            { status: 400 }
        );
    }

    const organizationId = readString(payload.organizationId);
    const eventType = readString(payload.eventType || payload.type);
    const providerEventId = readString(payload.providerEventId || payload.eventId || payload.id);
    const idempotencyKey = readString(payload.idempotencyKey) || providerEventId;

    if (!organizationId || !eventType || !idempotencyKey) {
        return NextResponse.json(
            {
                success: false,
                message: "organizationId, eventType, and idempotencyKey are required",
            },
            { status: 400 }
        );
    }

    const provider = normalizeProvider(readString(payload.provider).toUpperCase());
    const subscriptionId = readString(payload.subscriptionId) || undefined;
    const invoiceId = readString(payload.invoiceId) || undefined;
    const currency = readString(payload.currency) || undefined;
    const amountCents = typeof payload.amountCents === "number" && Number.isFinite(payload.amountCents)
        ? Math.round(payload.amountCents)
        : undefined;

    const event = await billingService.ingestPaymentWebhook({
        organizationId,
        provider,
        idempotencyKey,
        eventType,
        payload,
        providerEventId: providerEventId || undefined,
        subscriptionId,
        invoiceId,
        amountCents,
        currency,
    });

    return NextResponse.json({
        success: true,
        data: {
            id: event.id,
            status: event.status,
            retries: event.retries,
            nextRetryAt: event.nextRetryAt,
        },
    });
}
