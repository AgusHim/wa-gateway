import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { assertTrustedRouteOrigin } from "@/lib/security/csrf";
import { userRepo } from "@/lib/db/userRepo";
import { handoverRepo } from "@/lib/handover/repo";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
    try {
        assertTrustedRouteOrigin(request);
    } catch {
        return NextResponse.json({ success: false, message: "Invalid request origin" }, { status: 403 });
    }

    const auth = await requireApiSession("write");
    if (!auth.ok) return auth.response;

    const { userId } = await context.params;
    const user = await userRepo.getUserById(userId, auth.context.workspaceId);
    if (!user) {
        return NextResponse.json({ success: false, message: "Conversation user not found" }, { status: 404 });
    }

    await handoverRepo.clearPending(user.phoneNumber, auth.context.workspaceId);
    return NextResponse.json({ success: true, data: { handoverPending: false } });
}
