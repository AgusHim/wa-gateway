export type CircuitState = "closed" | "open" | "half_open";

export class CircuitBreakerOpenError extends Error {
    readonly retryAfterMs: number;

    constructor(key: string, retryAfterMs: number) {
        super(`Circuit breaker is open for key=${key}`);
        this.name = "CircuitBreakerOpenError";
        this.retryAfterMs = retryAfterMs;
    }
}

type CircuitRuntimeState = {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    openedAt: number;
    nextAttemptAt: number;
    lastFailureMessage?: string;
};

export type CircuitBreakerOptions = {
    failureThreshold?: number;
    resetTimeoutMs?: number;
    successThreshold?: number;
};

const DEFAULT_FAILURE_THRESHOLD = Number(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || 5);
const DEFAULT_RESET_TIMEOUT_MS = Number(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS || 30_000);
const DEFAULT_SUCCESS_THRESHOLD = Number(process.env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD || 1);

const globalForCircuitBreaker = globalThis as unknown as {
    __waGatewayCircuitBreakers?: Map<string, CircuitRuntimeState>;
};

const circuitMap = globalForCircuitBreaker.__waGatewayCircuitBreakers
    || new Map<string, CircuitRuntimeState>();
if (!globalForCircuitBreaker.__waGatewayCircuitBreakers) {
    globalForCircuitBreaker.__waGatewayCircuitBreakers = circuitMap;
}

function nowMs(): number {
    return Date.now();
}

function normalizeOptions(options?: CircuitBreakerOptions): Required<CircuitBreakerOptions> {
    return {
        failureThreshold: Number.isFinite(options?.failureThreshold)
            ? Math.max(1, Math.round(options?.failureThreshold as number))
            : Math.max(1, DEFAULT_FAILURE_THRESHOLD),
        resetTimeoutMs: Number.isFinite(options?.resetTimeoutMs)
            ? Math.max(10, Math.round(options?.resetTimeoutMs as number))
            : Math.max(10, DEFAULT_RESET_TIMEOUT_MS),
        successThreshold: Number.isFinite(options?.successThreshold)
            ? Math.max(1, Math.round(options?.successThreshold as number))
            : Math.max(1, DEFAULT_SUCCESS_THRESHOLD),
    };
}

function getState(key: string): CircuitRuntimeState {
    const existing = circuitMap.get(key);
    if (existing) {
        return existing;
    }

    const state: CircuitRuntimeState = {
        state: "closed",
        failureCount: 0,
        successCount: 0,
        openedAt: 0,
        nextAttemptAt: 0,
    };
    circuitMap.set(key, state);
    return state;
}

function resetState(state: CircuitRuntimeState): void {
    state.state = "closed";
    state.failureCount = 0;
    state.successCount = 0;
    state.openedAt = 0;
    state.nextAttemptAt = 0;
    state.lastFailureMessage = undefined;
}

export async function executeWithCircuitBreaker<T>(
    key: string,
    operation: () => Promise<T>,
    options?: CircuitBreakerOptions
): Promise<T> {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
        return operation();
    }

    const state = getState(normalizedKey);
    const config = normalizeOptions(options);
    const now = nowMs();

    if (state.state === "open") {
        if (state.nextAttemptAt > now) {
            throw new CircuitBreakerOpenError(normalizedKey, state.nextAttemptAt - now);
        }

        state.state = "half_open";
        state.successCount = 0;
    }

    try {
        const result = await operation();

        if (state.state === "half_open") {
            state.successCount += 1;
            if (state.successCount >= config.successThreshold) {
                resetState(state);
            }
        } else {
            state.failureCount = 0;
            state.successCount = 0;
            state.lastFailureMessage = undefined;
        }

        return result;
    } catch (error) {
        state.failureCount += 1;
        state.successCount = 0;
        state.lastFailureMessage = error instanceof Error ? error.message : String(error);

        if (state.failureCount >= config.failureThreshold || state.state === "half_open") {
            state.state = "open";
            state.openedAt = now;
            state.nextAttemptAt = now + config.resetTimeoutMs;
        } else {
            state.state = "closed";
        }

        throw error;
    }
}

export function getCircuitBreakerSnapshot(key: string) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
        return null;
    }

    const state = circuitMap.get(normalizedKey);
    if (!state) {
        return null;
    }

    return {
        key: normalizedKey,
        state: state.state,
        failureCount: state.failureCount,
        successCount: state.successCount,
        openedAt: state.openedAt || null,
        nextAttemptAt: state.nextAttemptAt || null,
        lastFailureMessage: state.lastFailureMessage || null,
    };
}

export function listCircuitBreakerSnapshots() {
    return Array.from(circuitMap.entries()).map(([key, state]) => ({
        key,
        state: state.state,
        failureCount: state.failureCount,
        successCount: state.successCount,
        openedAt: state.openedAt || null,
        nextAttemptAt: state.nextAttemptAt || null,
        lastFailureMessage: state.lastFailureMessage || null,
    }));
}
