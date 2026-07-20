import type { proto } from "@whiskeysockets/baileys";
import { extractMessageContent } from "@whiskeysockets/baileys";
import type { MessageAttachmentType } from "@/lib/media/types";
import { normalizeMimeType, sanitizeMediaFileName } from "@/lib/media/storage";

export type WhatsAppMediaDescriptor = {
    type: MessageAttachmentType;
    caption: string;
    fileName: string;
    mimeType: string;
    declaredByteSize?: number;
    durationMs?: number;
    isAnimated: boolean;
};

function toSafeNumber(value: unknown): number | undefined {
    if (value === null || value === undefined) return undefined;
    const candidate = typeof value === "object" && value && "toNumber" in value
        ? (value as { toNumber: () => number }).toNumber()
        : Number(value);
    if (!Number.isFinite(candidate) || candidate < 0) return undefined;
    return Math.round(candidate);
}

function fallbackExtension(mimeType: string): string {
    const extensions: Record<string, string> = {
        "application/pdf": "pdf",
        "audio/aac": "aac",
        "audio/mp4": "m4a",
        "audio/mpeg": "mp3",
        "audio/ogg": "ogg",
        "audio/opus": "opus",
        "audio/wav": "wav",
        "audio/webm": "webm",
        "image/webp": "webp",
    };
    return extensions[mimeType] || "bin";
}

export function extractWhatsAppMediaDescriptor(
    rawMessage: proto.IMessage | null | undefined
): WhatsAppMediaDescriptor | null {
    const message = extractMessageContent(rawMessage);
    if (!message) return null;

    if (message.documentMessage) {
        const media = message.documentMessage;
        const mimeType = normalizeMimeType(media.mimetype);
        return {
            type: "document",
            caption: media.caption?.trim() || "",
            fileName: sanitizeMediaFileName(media.fileName, `document.${fallbackExtension(mimeType)}`),
            mimeType,
            declaredByteSize: toSafeNumber(media.fileLength),
            isAnimated: false,
        };
    }

    if (message.audioMessage) {
        const media = message.audioMessage;
        const mimeType = normalizeMimeType(media.mimetype || "audio/ogg");
        const seconds = toSafeNumber(media.seconds);
        return {
            type: "audio",
            caption: "",
            fileName: sanitizeMediaFileName(undefined, `${media.ptt ? "voice-note" : "audio"}.${fallbackExtension(mimeType)}`),
            mimeType,
            declaredByteSize: toSafeNumber(media.fileLength),
            durationMs: seconds === undefined ? undefined : seconds * 1000,
            isAnimated: false,
        };
    }

    if (message.stickerMessage) {
        const media = message.stickerMessage;
        const mimeType = normalizeMimeType(media.mimetype || "image/webp");
        return {
            type: "sticker",
            caption: "",
            fileName: "sticker.webp",
            mimeType,
            declaredByteSize: toSafeNumber(media.fileLength),
            isAnimated: Boolean(media.isAnimated),
        };
    }

    return null;
}
