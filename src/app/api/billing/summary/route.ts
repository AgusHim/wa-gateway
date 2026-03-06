import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { billingService } from "@/lib/billing/service";

export const runtime = "nodejs";

export async function GET() {
    const auth = await requireApiSession("manage_billing");
    if (!auth.ok) {
        return auth.response;
    }

    const snapshot = await billingService.getBillingSnapshot(auth.context.workspaceId);
    return NextResponse.json({
        success: true,
        data: snapshot,
    });
}
