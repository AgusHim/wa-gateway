export function readRequiredString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export function isValidIdempotencyKey(value: string): boolean {
    return value.length >= 8
        && value.length <= 128
        && /^[a-zA-Z0-9._:-]+$/.test(value);
}

export function parseConversationLimit(value: string | null): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 50;
    return Math.max(1, Math.min(100, Math.round(parsed)));
}

export function parseByteRange(
    headerValue: string | null,
    byteSize: number
): { start: number; end: number } | null | "invalid" {
    if (!headerValue) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(headerValue.trim());
    if (!match || byteSize <= 0) return "invalid";

    const rawStart = match[1];
    const rawEnd = match[2];
    if (!rawStart && !rawEnd) return "invalid";

    if (!rawStart) {
        const suffixLength = Number(rawEnd);
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) return "invalid";
        const start = Math.max(0, byteSize - suffixLength);
        return { start, end: byteSize - 1 };
    }

    const start = Number(rawStart);
    const end = rawEnd ? Number(rawEnd) : byteSize - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= byteSize) {
        return "invalid";
    }
    return { start, end: Math.min(end, byteSize - 1) };
}
