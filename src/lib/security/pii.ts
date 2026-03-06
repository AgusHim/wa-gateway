const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)/g;
const CARD_PATTERN = /(?<!\d)(?:\d[ -]*?){13,19}(?!\d)/g;

function looksLikeCardNumber(value: string): boolean {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19;
}

export function redactPiiFromString(input: string): string {
    let value = input;

    value = value.replace(EMAIL_PATTERN, "[REDACTED_EMAIL]");
    value = value.replace(PHONE_PATTERN, (match) => {
        const digits = match.replace(/\D/g, "");
        return digits.length >= 8 ? "[REDACTED_PHONE]" : match;
    });
    value = value.replace(CARD_PATTERN, (match) => {
        return looksLikeCardNumber(match) ? "[REDACTED_CARD]" : match;
    });

    return value;
}

export function redactPii<T>(value: T): T {
    if (typeof value === "string") {
        return redactPiiFromString(value) as T;
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactPii(item)) as T;
    }

    if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        const next: Record<string, unknown> = {};

        for (const [key, entry] of Object.entries(obj)) {
            next[key] = redactPii(entry);
        }

        return next as T;
    }

    return value;
}
