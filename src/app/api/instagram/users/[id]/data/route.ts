import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { deleteInstagramUserData } from "@/lib/integrations/instagram/privacy";
import { assertTrustedRouteOrigin } from "@/lib/security/csrf";

export const runtime = "nodejs";

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        assertTrustedRouteOrigin(request);
    } catch {
        return NextResponse.json({ success: false, message: "Invalid request origin" }, { status: 403 });
    }

    const auth = await requireApiSession("manage_channel");
    if (!auth.ok) {
        return auth.response;
    }

    const { id } = await params;

    try {
        const data = await deleteInstagramUserData({
            workspaceId: auth.context.workspaceId,
            userId: id,
            deletedByUserId: auth.context.userId,
        });

        return NextResponse.json({
            success: true,
            message: "Instagram user data deleted",
            data,
        });
    } catch (error) {
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : "Failed to delete Instagram user data",
            },
            { status: 400 }
        );
    }
}
