import { TenantRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { billingService } from "@/lib/billing/service";
import {
    createOrganizationInvite,
    listOrganizationMembers,
    listOrganizationPendingInvites,
} from "@/lib/auth/tenantAuthService";
import { sendTenantEmail } from "@/lib/notifications/email";

export const runtime = "nodejs";

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function isOrgAdmin(role: TenantRole): boolean {
    return role === TenantRole.OWNER || role === TenantRole.ADMIN;
}

export async function GET() {
    const auth = await requireApiSession("read");
    if (!auth.ok) {
        return auth.response;
    }

    if (!isOrgAdmin(auth.context.membershipRole)) {
        return NextResponse.json(
            {
                success: false,
                message: "Forbidden",
            },
            { status: 403 }
        );
    }

    const { organizationId } = auth.context;
    const [members, invites] = await Promise.all([
        listOrganizationMembers(organizationId),
        listOrganizationPendingInvites(organizationId),
    ]);

    return NextResponse.json({
        success: true,
        data: {
            members,
            invites,
        },
    });
}

export async function POST(request: NextRequest) {
    const auth = await requireApiSession("write");
    if (!auth.ok) {
        return auth.response;
    }

    if (!isOrgAdmin(auth.context.membershipRole)) {
        return NextResponse.json(
            {
                success: false,
                message: "Forbidden",
            },
            { status: 403 }
        );
    }

    let payload: Record<string, unknown>;
    try {
        payload = await request.json() as Record<string, unknown>;
    } catch {
        return NextResponse.json(
            {
                success: false,
                message: "Invalid JSON payload",
            },
            { status: 400 }
        );
    }

    const email = readString(payload.email).toLowerCase();
    const roleValue = readString(payload.role);
    const role = Object.values(TenantRole).includes(roleValue as TenantRole)
        ? (roleValue as TenantRole)
        : TenantRole.VIEWER;

    if (!email) {
        return NextResponse.json(
            {
                success: false,
                message: "email is required",
            },
            { status: 400 }
        );
    }

    if (role === TenantRole.OWNER) {
        return NextResponse.json(
            {
                success: false,
                message: "Owner invite is not supported",
            },
            { status: 400 }
        );
    }

    const billingSnapshot = await billingService.getBillingSnapshot(auth.context.workspaceId);
    if (billingSnapshot.usage.seats.used >= billingSnapshot.usage.seats.limit) {
        return NextResponse.json(
            {
                success: false,
                message: "Seat limit reached for current plan",
            },
            { status: 402 }
        );
    }

    try {
        const { invite, rawToken } = await createOrganizationInvite({
            inviterUserId: auth.context.userId,
            organizationId: auth.context.organizationId,
            email,
            role,
        });

        const appUrl = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
        const inviteLink = `${appUrl}/accept-invite?token=${encodeURIComponent(rawToken)}`;

        await sendTenantEmail({
            to: email,
            subject: "Undangan bergabung ke WA Gateway",
            text: `Anda diundang bergabung ke organisasi. Buka link berikut untuk menerima undangan: ${inviteLink}`,
        });

        return NextResponse.json({
            success: true,
            message: "Invite berhasil dibuat",
            data: {
                invite,
                inviteLinkPreview: process.env.NODE_ENV === "production" ? undefined : inviteLink,
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create invite";
        return NextResponse.json(
            {
                success: false,
                message,
            },
            { status: 400 }
        );
    }
}
