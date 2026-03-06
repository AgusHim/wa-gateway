import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { billingService } from "@/lib/billing/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    const auth = await requireApiSession("manage_billing");
    if (!auth.ok) {
        return auth.response;
    }

    let payload: Record<string, unknown> = {};
    try {
        payload = await request.json() as Record<string, unknown>;
    } catch {
        payload = {};
    }

    const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit)
        ? Math.max(1, Math.min(100, Math.round(payload.limit)))
        : 20;

    const events = await billingService.retryFailedPaymentEvents(limit);

    return NextResponse.json({
        success: true,
        message: `Processed ${events.length} failed events`,
        data: {
            count: events.length,
            events,
        },
    });
}
