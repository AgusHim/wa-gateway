import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { authUserRepo } from "@/lib/db/authUserRepo";

export const runtime = "nodejs";

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
    const auth = await requireApiSession("read");
    if (!auth.ok) {
        return auth.response;
    }

    const user = await authUserRepo.findById(auth.context.userId);
    if (!user) {
        return NextResponse.json(
            {
                success: false,
                message: "User not found",
            },
            { status: 404 }
        );
    }

    const workspaces = user.workspaceMemberships
        .filter((membership) => membership.workspace.isActive)
        .map((membership) => ({
            workspaceId: membership.workspaceId,
            workspaceName: membership.workspace.name,
            organizationId: membership.workspace.organizationId,
            role: membership.role,
            isCurrent: membership.workspaceId === auth.context.workspaceId,
        }))
        .sort((a, b) => a.workspaceName.localeCompare(b.workspaceName));

    return NextResponse.json({
        success: true,
        data: {
            currentWorkspaceId: auth.context.workspaceId,
            currentOrganizationId: auth.context.organizationId,
            workspaces,
        },
    });
}

export async function POST(request: NextRequest) {
    const auth = await requireApiSession("read");
    if (!auth.ok) {
        return auth.response;
    }

    let payload: Record<string, unknown> = {};
    try {
        payload = await request.json() as Record<string, unknown>;
    } catch {
        payload = {};
    }

    const workspaceId = readString(payload.workspaceId);
    if (!workspaceId) {
        return NextResponse.json(
            {
                success: false,
                message: "workspaceId is required",
            },
            { status: 400 }
        );
    }

    const user = await authUserRepo.findById(auth.context.userId);
    const membership = user?.workspaceMemberships.find((item) => item.workspaceId === workspaceId);
    if (!membership) {
        return NextResponse.json(
            {
                success: false,
                message: "Workspace is not accessible for current user",
            },
            { status: 403 }
        );
    }

    await authUserRepo.setDefaultTenantContext(
        auth.context.userId,
        membership.workspace.organizationId,
        membership.workspaceId
    );

    return NextResponse.json({
        success: true,
        message: "Workspace context updated",
        data: {
            organizationId: membership.workspace.organizationId,
            workspaceId: membership.workspaceId,
        },
    });
}
