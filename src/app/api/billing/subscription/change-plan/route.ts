import { BillingCycle, PlanCode } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { billingService } from "@/lib/billing/service";
import { assertTrustedRouteOrigin } from "@/lib/security/csrf";

export const runtime = "nodejs";

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

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

    let payload: Record<string, unknown>;
    try {
        payload = await request.json() as Record<string, unknown>;
    } catch {
        return NextResponse.json({ success: false, message: "Invalid JSON payload" }, { status: 400 });
    }

    const planCodeValue = readString(payload.planCode);
    const billingCycleValue = readString(payload.billingCycle);

    if (!Object.values(PlanCode).includes(planCodeValue as PlanCode)) {
        return NextResponse.json({ success: false, message: "Invalid planCode" }, { status: 400 });
    }

    const billingCycle = Object.values(BillingCycle).includes(billingCycleValue as BillingCycle)
        ? (billingCycleValue as BillingCycle)
        : BillingCycle.MONTHLY;

    const subscription = await billingService.changePlan({
        organizationId: auth.context.organizationId,
        planCode: planCodeValue as PlanCode,
        billingCycle,
    });

    return NextResponse.json({
        success: true,
        message: "Plan berhasil diubah",
        data: {
            id: subscription.id,
            planCode: subscription.plan.code,
            billingCycle: subscription.billingCycle,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
        },
    });
}
