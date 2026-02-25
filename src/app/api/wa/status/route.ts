import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
    const [{ ensureGatewayBootstrapped }, { getConnectionStatus }] = await Promise.all([
        import("@/lib/runtime/bootstrapServer"),
        import("@/lib/baileys/client"),
    ]);

    // Lazy-ensure core services are started in case instrumentation is skipped.
    await ensureGatewayBootstrapped();

    return NextResponse.json({
        status: getConnectionStatus(),
    });
}
