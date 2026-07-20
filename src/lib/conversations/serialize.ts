import type { Message, MessageAttachment } from "@prisma/client";
import type { AttachmentView } from "@/lib/media/types";

type MessageWithAttachments = Message & { attachments: MessageAttachment[] };

function serializeAttachment(attachment: MessageAttachment): AttachmentView {
    const ready = attachment.status === "ready" && Boolean(attachment.storageKey);
    return {
        id: attachment.id,
        type: attachment.type as AttachmentView["type"],
        status: attachment.status as AttachmentView["status"],
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
        durationMs: attachment.durationMs,
        isAnimated: attachment.isAnimated,
        errorMessage: ready ? null : "Media tidak tersedia",
        url: ready ? `/api/conversations/media/${attachment.id}` : null,
    };
}

export function serializeConversationMessage(message: MessageWithAttachments) {
    const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
        ? message.metadata as Record<string, unknown>
        : {};
    return {
        id: message.id,
        userId: message.userId,
        channelId: message.channelId || (typeof metadata.channelId === "string" ? metadata.channelId : null),
        role: message.role,
        content: message.content,
        source: typeof metadata.source === "string" ? metadata.source : null,
        deliveryStatus: message.deliveryStatus,
        externalMessageId: message.externalMessageId,
        createdAt: message.createdAt.toISOString(),
        updatedAt: message.updatedAt.toISOString(),
        attachments: message.attachments.map(serializeAttachment),
    };
}
