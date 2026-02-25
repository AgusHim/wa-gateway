import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
    const { disconnectWhatsApp, connectToWhatsApp } = await import("@/lib/baileys/client");

    await disconnectWhatsApp();
    await connectToWhatsApp();

    return NextResponse.json({
        success: true,
        message: "Session cleared and reconnect started",
    });
}
