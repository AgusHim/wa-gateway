import { EventEmitter } from "events";

/**
 * Global event bus for WA events: qr, connection-status, new-message
 */
export const waEvents = new EventEmitter();
waEvents.setMaxListeners(20);

// Event types
export interface WAEventMap {
    qr: string;
    "connection-update": { status: "open" | "close" | "connecting"; message?: string };
    "new-message": {
        phoneNumber: string;
        messageText: string;
        messageId: string;
        pushName?: string;
        timestamp: number;
    };
}
