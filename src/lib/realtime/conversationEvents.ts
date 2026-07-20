import { EventEmitter } from "node:events";

export type ConversationEventPayload = {
    workspaceId: string;
    channelId?: string | null;
    userId: string;
    messageId: string;
    deliveryStatus?: string | null;
};

export const conversationEvents = new EventEmitter();
conversationEvents.setMaxListeners(200);

export function emitConversationMessage(payload: ConversationEventPayload) {
    conversationEvents.emit("message", payload);
}

export function emitConversationStatus(payload: ConversationEventPayload) {
    conversationEvents.emit("status", payload);
}
