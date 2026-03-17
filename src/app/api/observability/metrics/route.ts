import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { getMetricsSnapshot } from "@/lib/observability/metrics";
import { listWorkerRuntimeSnapshots } from "@/lib/observability/workerRuntime";
import { listCircuitBreakerSnapshots } from "@/lib/resilience/circuitBreaker";

export const runtime = "nodejs";

function sanitizeQueuePart(value: string): string {
    return value.trim().replace(/:/g, "_");
}

function parseWindowMinutes(request: NextRequest): number {
    const raw = request.nextUrl.searchParams.get("windowMinutes");
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        return 15;
    }

    return Math.max(1, Math.min(24 * 60, Math.round(value)));
}

export async function GET(request: NextRequest) {
    const auth = await requireApiSession("read");
    if (!auth.ok) {
        return auth.response;
    }

    const windowMinutes = parseWindowMinutes(request);
    const workspaceQueuePart = sanitizeQueuePart(auth.context.workspaceId);
    const metrics = await getMetricsSnapshot(windowMinutes, {
        workspaceId: auth.context.workspaceId,
    });

    return NextResponse.json({
        success: true,
        data: {
            generatedAt: new Date().toISOString(),
            workspaceId: auth.context.workspaceId,
            windowMinutes,
            metrics,
            circuitBreakers: listCircuitBreakerSnapshots()
                .filter((snapshot) => snapshot.key.includes(`:${auth.context.workspaceId}:`) || snapshot.key.startsWith(`ai:${auth.context.workspaceId}:`)),
            workerRuntimes: listWorkerRuntimeSnapshots()
                .filter((snapshot) => snapshot.queueName.includes(`--${workspaceQueuePart}--`)),
        },
    });
}
