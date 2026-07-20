export type MessageAttachmentType = "document" | "audio" | "sticker";
export type MessageAttachmentStatus = "ready" | "failed";

export type InboundAttachmentPayload = {
    type: MessageAttachmentType;
    status: MessageAttachmentStatus;
    storageKey?: string;
    fileName?: string;
    mimeType: string;
    byteSize?: number;
    checksum?: string;
    durationMs?: number;
    isAnimated?: boolean;
    errorMessage?: string;
};

export type AttachmentView = {
    id: string;
    type: MessageAttachmentType;
    status: MessageAttachmentStatus;
    fileName: string | null;
    mimeType: string;
    byteSize: number | null;
    durationMs: number | null;
    isAnimated: boolean;
    errorMessage: string | null;
    url: string | null;
};

export function attachmentPlaceholder(type: MessageAttachmentType): string {
    if (type === "audio") return "[Audio]";
    if (type === "sticker") return "[Sticker]";
    return "[Document]";
}
