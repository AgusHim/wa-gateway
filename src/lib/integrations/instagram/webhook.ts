import crypto from "crypto";
import type { InstagramInboundEventType } from "./webhookQueue";

export type NormalizedInstagramWebhookEvent = {
    eventId: string;
    eventKey: string;
    eventType: InstagramInboundEventType;
    occurredAt: number;
    sourceObject: string;
    pageId?: string;
    instagramAccountId?: string;
    igUserId?: string;
    igUsername?: string;
    threadId?: string;
    commentId?: string;
    mediaId?: string;
    messageId?: string;
    messageText?: string;
    rawEvent: Record<string, unknown>;
};

function readRecord(value: unknown): Record<string, unknown> {
    return (value && typeof value === "object" && !Array.isArray(value))
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asArray<T = unknown>(value: unknown): T[] {
    return Array.isArray(value) ? value as T[] : [];
}

function hashText(value: string, length: number = 24): string {
    return crypto.createHash("sha256").update(value).digest("hex").slice(0, Math.max(8, length));
}

function normalizeTimestamp(value: unknown): number {
    const parsed = readNumber(value);
    if (!parsed) {
        return Date.now();
    }

    if (parsed < 10_000_000_000) {
        return Math.round(parsed * 1000);
    }

    return Math.round(parsed);
}

function pickMessageText(messageRecord: Record<string, unknown>): string | undefined {
    const text = readString(messageRecord.text);
    if (text) {
        return text;
    }

    const attachments = asArray(messageRecord.attachments);
    if (attachments.length > 0) {
        return "[attachment]";
    }

    return undefined;
}

export function verifyInstagramWebhookSignature(input: {
    appSecret: string;
    rawBody: string;
    signatureHeader: string;
}): boolean {
    const secret = input.appSecret.trim();
    const signature = input.signatureHeader.trim();
    if (!secret || !signature || !signature.startsWith("sha256=")) {
        return false;
    }

    const expected = `sha256=${crypto.createHmac("sha256", secret).update(input.rawBody).digest("hex")}`;
    if (expected.length !== signature.length) {
        return false;
    }

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function buildInstagramWebhookEventId(input: {
    eventKey: string;
    eventType: InstagramInboundEventType;
    pageId?: string;
    instagramAccountId?: string;
}): string {
    return `igw_${hashText(`${input.eventType}:${input.pageId || "-"}:${input.instagramAccountId || "-"}:${input.eventKey}`, 30)}`;
}

function buildFallbackEventKey(eventType: InstagramInboundEventType, rawEvent: Record<string, unknown>): string {
    return `${eventType}:${hashText(JSON.stringify(rawEvent), 28)}`;
}

function normalizeDmEvent(entry: Record<string, unknown>, messaging: Record<string, unknown>): NormalizedInstagramWebhookEvent | null {
    const sender = readRecord(messaging.sender);
    const recipient = readRecord(messaging.recipient);
    const messageRecord = readRecord(messaging.message);

    const senderId = readString(sender.id);
    const recipientId = readString(recipient.id);
    const messageId = readString(messageRecord.mid);
    const messageText = pickMessageText(messageRecord);
    if (!senderId && !messageId) {
        return null;
    }

    const pageId = readString(entry.id) || recipientId;
    const instagramAccountId = recipientId;
    const occurredAt = normalizeTimestamp(messaging.timestamp || messageRecord.created_time);

    const keyParts = [
        "dm",
        pageId || "-",
        instagramAccountId || "-",
        senderId || "-",
        messageId || "-",
        String(occurredAt),
    ];
    const eventKey = keyParts.join(":");

    const rawEvent = {
        entry,
        messaging,
    };

    return {
        eventId: buildInstagramWebhookEventId({
            eventKey,
            eventType: "instagram-dm",
            pageId,
            instagramAccountId,
        }),
        eventKey,
        eventType: "instagram-dm",
        occurredAt,
        sourceObject: "instagram",
        pageId,
        instagramAccountId,
        igUserId: senderId,
        threadId: senderId,
        messageId,
        messageText,
        rawEvent,
    };
}

function normalizeCommentEvent(entry: Record<string, unknown>, change: Record<string, unknown>): NormalizedInstagramWebhookEvent | null {
    const field = readString(change.field)?.toLowerCase();
    if (field !== "comments" && field !== "mentions") {
        return null;
    }

    const value = readRecord(change.value);
    const from = readRecord(value.from);
    const media = readRecord(value.media);
    const pageId = readString(entry.id);
    const instagramAccountId = readString(value.instagram_account_id) || readString(value.instagram_business_account_id);
    const commentId = readString(value.id) || readString(value.comment_id);
    const mediaId = readString(media.id) || readString(value.media_id);
    const igUserId = readString(from.id);
    const igUsername = readString(from.username);
    const messageText = readString(value.text);
    const occurredAt = normalizeTimestamp(value.created_time || value.timestamp);

    const rawEvent = {
        entry,
        change,
    };

    const baseKey = [
        "comment",
        field,
        pageId || "-",
        instagramAccountId || "-",
        mediaId || "-",
        commentId || "-",
        igUserId || "-",
        String(occurredAt),
    ].join(":");

    const eventKey = (commentId || mediaId)
        ? baseKey
        : buildFallbackEventKey("instagram-comment", rawEvent);

    return {
        eventId: buildInstagramWebhookEventId({
            eventKey,
            eventType: "instagram-comment",
            pageId,
            instagramAccountId,
        }),
        eventKey,
        eventType: "instagram-comment",
        occurredAt,
        sourceObject: "instagram",
        pageId,
        instagramAccountId,
        igUserId,
        igUsername,
        threadId: mediaId || commentId,
        commentId,
        mediaId,
        messageText,
        rawEvent,
    };
}

export function normalizeInstagramWebhookPayload(payload: unknown): NormalizedInstagramWebhookEvent[] {
    const root = readRecord(payload);
    const objectName = readString(root.object)?.toLowerCase();
    if (objectName !== "instagram") {
        return [];
    }

    const events: NormalizedInstagramWebhookEvent[] = [];

    for (const entryItem of asArray(root.entry)) {
        const entry = readRecord(entryItem);

        for (const messagingItem of asArray(entry.messaging)) {
            const messaging = readRecord(messagingItem);
            const event = normalizeDmEvent(entry, messaging);
            if (event) {
                events.push(event);
            }
        }

        for (const changeItem of asArray(entry.changes)) {
            const change = readRecord(changeItem);
            const event = normalizeCommentEvent(entry, change);
            if (event) {
                events.push(event);
            }
        }
    }

    return events;
}
