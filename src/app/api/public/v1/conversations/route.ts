import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requirePublicApiKey } from "@/lib/security/publicApiAuth";

export const runtime = "nodejs";

function normalizePhone(raw: string): string {
    const value = raw.trim();
    if (!value) return "";
    if (value.includes("@")) return value;

    const digits = value.replace(/\D/g, "");
    if (!digits) return "";
    if (digits.startsWith("0")) return `62${digits.slice(1)}`;
    if (digits.startsWith("8")) return `62${digits}`;
    return digits;
}

export async function GET(request: NextRequest) {
    const auth = await requirePublicApiKey(request, ["conversations:read"]);
    if (!auth.ok) {
        return auth.response;
    }

    const workspaceId = auth.context.workspaceId;
    const phoneNumberRaw = request.nextUrl.searchParams.get("phoneNumber")?.trim() || "";
    const limitRaw = Number(request.nextUrl.searchParams.get("limit"));
    const pageRaw = Number(request.nextUrl.searchParams.get("page"));
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.round(limitRaw))) : 50;
    const page = Number.isFinite(pageRaw) ? Math.max(1, Math.round(pageRaw)) : 1;
    const skip = (page - 1) * limit;

    if (!phoneNumberRaw) {
        const users = await prisma.chatUser.findMany({
            where: { workspaceId },
            orderBy: [{ updatedAt: "desc" }],
            skip,
            take: limit,
            include: {
                conversations: {
                    orderBy: [{ createdAt: "desc" }],
                    take: 1,
                    select: {
                        id: true,
                        role: true,
                        content: true,
                        createdAt: true,
                    },
                },
                _count: {
                    select: { conversations: true },
                },
            },
        });

        return NextResponse.json({
            success: true,
            data: {
                page,
                limit,
                users: users.map((user) => ({
                    id: user.id,
                    phoneNumber: user.phoneNumber,
                    name: user.name,
                    label: user.label,
                    segments: user.segments,
                    messageCount: user._count.conversations,
                    lastMessage: user.conversations[0] ?? null,
                })),
            },
        });
    }

    const phoneNumber = normalizePhone(phoneNumberRaw);
    if (!phoneNumber) {
        return NextResponse.json(
            {
                success: false,
                message: "Invalid phoneNumber",
            },
            { status: 400 }
        );
    }

    const user = await prisma.chatUser.findFirst({
        where: {
            workspaceId,
            phoneNumber,
        },
        select: {
            id: true,
            phoneNumber: true,
            name: true,
            label: true,
            segments: true,
        },
    });
    if (!user) {
        return NextResponse.json(
            {
                success: false,
                message: "User not found",
            },
            { status: 404 }
        );
    }

    const messages = await prisma.message.findMany({
        where: {
            workspaceId,
            userId: user.id,
        },
        orderBy: [{ createdAt: "asc" }],
        skip,
        take: limit,
        select: {
            id: true,
            role: true,
            content: true,
            toolName: true,
            metadata: true,
            createdAt: true,
        },
    });

    return NextResponse.json({
        success: true,
        data: {
            page,
            limit,
            user,
            messages,
        },
    });
}
