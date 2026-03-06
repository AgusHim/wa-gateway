import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requirePublicApiKey } from "@/lib/security/publicApiAuth";

export const runtime = "nodejs";

type ContactPayload = {
    phoneNumber?: unknown;
    phone_number?: unknown;
    name?: unknown;
    label?: unknown;
    segments?: unknown;
};

function safeString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

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

function parseContact(item: ContactPayload): {
    phoneNumber: string;
    name?: string;
    label?: string;
    segments: string[];
} | null {
    const rawPhone = safeString(item.phoneNumber) || safeString(item.phone_number);
    const phoneNumber = normalizePhone(rawPhone);
    if (!phoneNumber) {
        return null;
    }

    const segments = Array.isArray(item.segments)
        ? Array.from(
            new Set(
                item.segments
                    .map((entry) => safeString(entry))
                    .filter(Boolean)
            )
        )
        : [];

    const name = safeString(item.name) || undefined;
    const label = safeString(item.label) || undefined;

    return { phoneNumber, name, label, segments };
}

export async function POST(request: NextRequest) {
    const auth = await requirePublicApiKey(request, ["contacts:write"]);
    if (!auth.ok) {
        return auth.response;
    }

    let payload: Record<string, unknown>;
    try {
        payload = await request.json() as Record<string, unknown>;
    } catch {
        return NextResponse.json(
            { success: false, message: "Invalid JSON payload" },
            { status: 400 }
        );
    }

    const candidates: ContactPayload[] = Array.isArray(payload.contacts)
        ? payload.contacts as ContactPayload[]
        : [payload as ContactPayload];
    const contacts = candidates
        .map(parseContact)
        .filter((value): value is NonNullable<typeof value> => Boolean(value));

    if (contacts.length === 0) {
        return NextResponse.json(
            { success: false, message: "No valid contacts provided" },
            { status: 400 }
        );
    }

    const workspaceId = auth.context.workspaceId;
    let created = 0;
    let updated = 0;

    for (const contact of contacts) {
        const existing = await prisma.chatUser.findFirst({
            where: {
                workspaceId,
                phoneNumber: contact.phoneNumber,
            },
            select: {
                id: true,
                segments: true,
            },
        });

        if (!existing) {
            await prisma.chatUser.create({
                data: {
                    workspaceId,
                    phoneNumber: contact.phoneNumber,
                    name: contact.name,
                    label: contact.label,
                    segments: contact.segments,
                },
            });
            created += 1;
            continue;
        }

        const mergedSegments = Array.from(new Set([...(existing.segments || []), ...contact.segments]));
        await prisma.chatUser.update({
            where: { id: existing.id },
            data: {
                name: contact.name ?? undefined,
                label: contact.label ?? undefined,
                segments: mergedSegments,
            },
        });
        updated += 1;
    }

    return NextResponse.json({
        success: true,
        data: {
            workspaceId,
            total: contacts.length,
            created,
            updated,
        },
    });
}
