import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { billingService } from "@/lib/billing/service";
import { assertTrustedRouteOrigin } from "@/lib/security/csrf";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    try {
        assertTrustedRouteOrigin(request);
    } catch {
        return NextResponse.json({ success: false, message: "Invalid request origin" }, { status: 403 });
    }

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

    const immediate = payload.immediate === true;
    const subscription = await billingService.cancelSubscription(auth.context.organizationId, immediate);

    return NextResponse.json({
        success: true,
        message: immediate
            ? "Subscription langsung dihentikan"
            : "Subscription akan berhenti di akhir periode",
        data: {
            id: subscription.id,
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            canceledAt: subscription.canceledAt,
            endedAt: subscription.endedAt,
            currentPeriodEnd: subscription.currentPeriodEnd,
        },
    });
}
