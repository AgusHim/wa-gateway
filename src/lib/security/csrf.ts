import type { NextRequest } from "next/server";
import { headers } from "next/headers";

type OriginValidationInput = {
    originHeader?: string | null;
    refererHeader?: string | null;
    hostHeader?: string | null;
    forwardedProtoHeader?: string | null;
    additionalTrustedOrigins?: string[];
};

function normalizeOrigin(value: string | null | undefined): string | null {
    if (!value) {
        return null;
    }

    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

function buildHostOrigin(hostHeader?: string | null, forwardedProtoHeader?: string | null): string | null {
    if (!hostHeader) {
        return null;
    }

    const host = hostHeader.trim();
    if (!host) {
        return null;
    }

    const protocol = (forwardedProtoHeader || "https").split(",")[0]?.trim() || "https";
    return normalizeOrigin(`${protocol}://${host}`);
}

function readConfiguredOrigins(): string[] {
    return [
        process.env.NEXTAUTH_URL,
        process.env.APP_BASE_URL,
        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
    ]
        .map((value) => normalizeOrigin(value))
        .filter((value): value is string => Boolean(value));
}

export function isTrustedMutationOrigin(input: OriginValidationInput): boolean {
    const requestOrigin = normalizeOrigin(input.originHeader) || normalizeOrigin(input.refererHeader);
    if (!requestOrigin) {
        return false;
    }

    const trustedOrigins = new Set<string>([
        ...readConfiguredOrigins(),
        ...((input.additionalTrustedOrigins || []).map((value) => normalizeOrigin(value)).filter((value): value is string => Boolean(value))),
    ]);

    const hostOrigin = buildHostOrigin(input.hostHeader, input.forwardedProtoHeader);
    if (hostOrigin) {
        trustedOrigins.add(hostOrigin);
    }

    return trustedOrigins.has(requestOrigin);
}

export function assertTrustedMutationOrigin(input: OriginValidationInput) {
    if (!isTrustedMutationOrigin(input)) {
        throw new Error("Invalid request origin");
    }
}

export async function assertTrustedServerActionOrigin() {
    const headerStore = await headers();
    assertTrustedMutationOrigin({
        originHeader: headerStore.get("origin"),
        refererHeader: headerStore.get("referer"),
        hostHeader: headerStore.get("x-forwarded-host") || headerStore.get("host"),
        forwardedProtoHeader: headerStore.get("x-forwarded-proto"),
    });
}

export function assertTrustedRouteOrigin(request: NextRequest) {
    assertTrustedMutationOrigin({
        originHeader: request.headers.get("origin"),
        refererHeader: request.headers.get("referer"),
        hostHeader: request.headers.get("x-forwarded-host") || request.headers.get("host"),
        forwardedProtoHeader: request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", ""),
        additionalTrustedOrigins: [request.nextUrl.origin],
    });
}
