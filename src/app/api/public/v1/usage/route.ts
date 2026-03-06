import { NextRequest, NextResponse } from "next/server";
import { billingService } from "@/lib/billing/service";
import { requirePublicApiKey } from "@/lib/security/publicApiAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    const auth = await requirePublicApiKey(request, ["usage:read"]);
    if (!auth.ok) {
        return auth.response;
    }

    try {
        const snapshot = await billingService.getBillingSnapshot(auth.context.workspaceId);
        return NextResponse.json({
            success: true,
            data: {
                organizationId: snapshot.organizationId,
                workspaceId: snapshot.workspaceId,
                month: snapshot.usage.month,
                usage: snapshot.usage,
                subscription: snapshot.subscription,
            },
        });
    } catch (error) {
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : "Failed to load usage",
            },
            { status: 500 }
        );
    }
}
