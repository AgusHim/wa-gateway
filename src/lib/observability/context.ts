import { AsyncLocalStorage } from "node:async_hooks";

export type ObservationContext = {
    correlationId?: string;
    traceId?: string;
    spanId?: string;
    spanName?: string;
    provider?: string;
    organizationId?: string;
    workspaceId?: string;
    channelId?: string;
    igUserId?: string;
    threadId?: string;
    eventId?: string;
    eventType?: string;
    messageId?: string;
    queueName?: string;
    jobId?: string;
    component?: string;
};

const storage = new AsyncLocalStorage<ObservationContext>();

function sanitizeContext(context: ObservationContext): ObservationContext {
    const output: ObservationContext = {};

    for (const [key, value] of Object.entries(context) as Array<[keyof ObservationContext, string | undefined]>) {
        if (typeof value === "string" && value.trim()) {
            output[key] = value.trim();
        }
    }

    return output;
}

export function getObservationContext(): ObservationContext {
    return storage.getStore() ?? {};
}

export function withObservationContext<T>(
    context: ObservationContext,
    fn: () => T
): T {
    const parent = getObservationContext();
    const merged = sanitizeContext({
        ...parent,
        ...context,
    });

    return storage.run(merged, fn);
}

export function updateObservationContext(context: ObservationContext): void {
    const current = storage.getStore();
    if (!current) {
        return;
    }

    const next = sanitizeContext(context);
    Object.assign(current, next);
}
