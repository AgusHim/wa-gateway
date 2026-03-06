import { getObservationContext } from "./context";

type LogLevel = "debug" | "info" | "warn" | "error";

function serializeError(error: unknown): Record<string, unknown> | undefined {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }

    if (!error) {
        return undefined;
    }

    try {
        return {
            value: JSON.stringify(error),
        };
    } catch {
        return {
            value: String(error),
        };
    }
}

function writeLog(level: LogLevel, message: string, fields?: Record<string, unknown>) {
    const payload = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...getObservationContext(),
        ...(fields || {}),
    };

    const raw = JSON.stringify(payload);

    if (level === "error") {
        console.error(raw);
        return;
    }

    if (level === "warn") {
        console.warn(raw);
        return;
    }

    if (level === "debug") {
        console.debug(raw);
        return;
    }

    console.log(raw);
}

export function logDebug(message: string, fields?: Record<string, unknown>) {
    writeLog("debug", message, fields);
}

export function logInfo(message: string, fields?: Record<string, unknown>) {
    writeLog("info", message, fields);
}

export function logWarn(message: string, fields?: Record<string, unknown>) {
    writeLog("warn", message, fields);
}

export function logError(message: string, error?: unknown, fields?: Record<string, unknown>) {
    writeLog("error", message, {
        ...(fields || {}),
        error: serializeError(error),
    });
}
