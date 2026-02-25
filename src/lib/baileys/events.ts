import { EventEmitter } from "events";

/**
 * Global event bus for WA events: qr, connection-status, new-message
 */
export const waEvents = new EventEmitter();
waEvents.setMaxListeners(20);

type WAConnectionStatus = "open" | "close" | "connecting";

type NewMessagePayload = {
    phoneNumber: string;
    messageText: string;
    messageId: string;
    pushName?: string;
    timestamp: number;
};

// Keep latest state so new SSE subscribers can receive current snapshot.
let latestQr: string | null = null;
let latestConnectionStatus: WAConnectionStatus = "close";

export function emitQr(qr: string) {
    latestQr = qr;
    waEvents.emit("qr", qr);
}

export function emitConnectionUpdate(payload: { status: WAConnectionStatus; message?: string }) {
    latestConnectionStatus = payload.status;
    waEvents.emit("connection-update", payload);
}

export function emitNewMessage(payload: NewMessagePayload) {
    waEvents.emit("new-message", payload);
}

export function getLatestQr() {
    return latestQr;
}

export function clearLatestQr() {
    latestQr = null;
}

export function getLatestConnectionStatus() {
    return latestConnectionStatus;
}

// Event types
export interface WAEventMap {
    qr: string;
    "connection-update": { status: WAConnectionStatus; message?: string };
    "new-message": NewMessagePayload;
}
