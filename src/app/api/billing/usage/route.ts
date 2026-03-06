import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { billingService } from "@/lib/billing/service";

export const runtime = "nodejs";

export async function GET() {
    const auth = await requireApiSession("read");
    if (!auth.ok) {
        return auth.response;
    }

    const snapshot = await billingService.getBillingSnapshot(auth.context.workspaceId);
    return NextResponse.json({
        success: true,
        data: {
            workspaceId: snapshot.workspaceId,
            month: snapshot.usage.month,
            plan: snapshot.subscription.plan,
            usage: snapshot.usage,
        },
    });
}
