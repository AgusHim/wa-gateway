import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
    const { disconnectWhatsApp } = await import("@/lib/baileys/client");
    await disconnectWhatsApp();

    return NextResponse.json({
        success: true,
        message: "WhatsApp disconnected and session cleared",
    });
}
