import { ChannelProvider, normalizeChannelProvider } from "./provider";

type ResolveUserIdentityInput = {
    provider: ChannelProvider | string;
    phoneNumber?: string;
    externalUserId?: string;
    username?: string;
};

function sanitizeToken(value: string): string {
    return value.trim().toLowerCase();
}

export function resolveChannelUserIdentifier(input: ResolveUserIdentityInput): string {
    const provider = normalizeChannelProvider(input.provider);

    if (provider === "whatsapp") {
        const phone = input.phoneNumber?.trim();
        if (!phone) {
            throw new Error("phoneNumber is required for whatsapp identity");
        }
        return phone;
    }

    const externalUserId = input.externalUserId?.trim();
    if (externalUserId) {
        return `ig:${sanitizeToken(externalUserId)}`;
    }

    const username = input.username?.trim();
    if (username) {
        return `ig:u:${sanitizeToken(username)}`;
    }

    throw new Error("externalUserId or username is required for instagram identity");
}

export function resolveChannelUserDisplayName(input: ResolveUserIdentityInput): string | undefined {
    const provider = normalizeChannelProvider(input.provider);
    if (provider === "whatsapp") {
        return undefined;
    }

    const username = input.username?.trim();
    if (!username) {
        return undefined;
    }

    if (username.startsWith("@")) {
        return username;
    }

    return `@${username}`;
}
