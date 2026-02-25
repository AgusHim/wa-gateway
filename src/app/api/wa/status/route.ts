import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
    const [{ ensureGatewayBootstrapped }, { getConnectionStatus }, { sessionRepo }] = await Promise.all([
        import("@/lib/runtime/bootstrapServer"),
        import("@/lib/baileys/client"),
        import("@/lib/db/sessionRepo"),
    ]);

    // Lazy-ensure core services are started in case instrumentation is skipped.
    await ensureGatewayBootstrapped();

    const sessionId = process.env.WA_SESSION_ID || "main-session";
    const persisted = await sessionRepo.getSession(`${sessionId}:connection-status`);

    return NextResponse.json({
        status: (persisted?.data as "open" | "close" | "connecting" | undefined) ?? getConnectionStatus(),
    });
}
