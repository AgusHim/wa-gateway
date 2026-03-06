import crypto from "crypto";
import { withObservationContext } from "./context";
import { logDebug, logError } from "./logger";

function generateId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function generateTraceId(): string {
    return generateId("trc");
}

export function generateCorrelationId(): string {
    return generateId("corr");
}

function generateSpanId(): string {
    return generateId("spn");
}

export async function withTraceSpan<T>(
    spanName: string,
    fn: () => Promise<T>,
    fields?: Record<string, unknown>
): Promise<T> {
    const spanId = generateSpanId();
    const start = Date.now();

    return withObservationContext({ spanId, spanName }, async () => {
        logDebug("trace.span.start", {
            spanName,
            ...(fields || {}),
        });

        try {
            const result = await fn();
            logDebug("trace.span.end", {
                spanName,
                durationMs: Date.now() - start,
                ...(fields || {}),
            });
            return result;
        } catch (error) {
            logError("trace.span.error", error, {
                spanName,
                durationMs: Date.now() - start,
                ...(fields || {}),
            });
            throw error;
        }
    }) as Promise<T>;
}
