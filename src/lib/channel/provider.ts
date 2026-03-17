export const CHANNEL_PROVIDERS = ["whatsapp", "instagram"] as const;

export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];

export function isChannelProvider(value: unknown): value is ChannelProvider {
    if (typeof value !== "string") {
        return false;
    }

    const normalized = value.trim().toLowerCase();
    return CHANNEL_PROVIDERS.includes(normalized as ChannelProvider);
}

export function parseChannelProvider(value: unknown): ChannelProvider | null {
    if (!isChannelProvider(value)) {
        return null;
    }

    return value.trim().toLowerCase() as ChannelProvider;
}

export function normalizeChannelProvider(value: unknown, fallback: ChannelProvider = "whatsapp"): ChannelProvider {
    return parseChannelProvider(value) || fallback;
}

export function isWhatsAppProvider(value: unknown): boolean {
    return normalizeChannelProvider(value) === "whatsapp";
}

export function isInstagramProvider(value: unknown): boolean {
    return normalizeChannelProvider(value) === "instagram";
}
