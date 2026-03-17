export const INSTAGRAM_MESSAGE_SOURCE = "instagram";

export const INSTAGRAM_EVENT_TYPES = [
    "instagram-dm",
    "instagram-comment",
] as const;

export type InstagramMessageEventType = (typeof INSTAGRAM_EVENT_TYPES)[number];

export type InstagramMessageMetadata = {
    source: typeof INSTAGRAM_MESSAGE_SOURCE;
    eventType: InstagramMessageEventType;
    channelId: string;
    igUserId?: string;
    igUsername?: string;
    threadId?: string;
    commentId?: string;
    mediaId?: string;
    pageId?: string;
    instagramAccountId?: string;
};

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isInstagramEventType(value: unknown): value is InstagramMessageEventType {
    return typeof value === "string" && INSTAGRAM_EVENT_TYPES.includes(value as InstagramMessageEventType);
}

export function buildInstagramMessageMetadata(input: {
    eventType: InstagramMessageEventType;
    channelId: string;
    igUserId?: string;
    igUsername?: string;
    threadId?: string;
    commentId?: string;
    mediaId?: string;
    pageId?: string;
    instagramAccountId?: string;
}): InstagramMessageMetadata {
    const channelId = input.channelId.trim();
    if (!channelId) {
        throw new Error("channelId is required for Instagram metadata");
    }

    return {
        source: INSTAGRAM_MESSAGE_SOURCE,
        eventType: input.eventType,
        channelId,
        igUserId: readString(input.igUserId),
        igUsername: readString(input.igUsername),
        threadId: readString(input.threadId),
        commentId: readString(input.commentId),
        mediaId: readString(input.mediaId),
        pageId: readString(input.pageId),
        instagramAccountId: readString(input.instagramAccountId),
    };
}

export function isInstagramMessageMetadata(value: unknown): value is InstagramMessageMetadata {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    const source = value as Record<string, unknown>;
    const channelId = readString(source.channelId);
    return source.source === INSTAGRAM_MESSAGE_SOURCE
        && isInstagramEventType(source.eventType)
        && Boolean(channelId);
}
