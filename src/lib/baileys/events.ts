import { EventEmitter } from "events";

export type WAConnectionStatus = "open" | "close" | "connecting";
export type WAHealthStatus = "connected" | "degraded" | "disconnected" | "banned-risk";

export type QrEventPayload = {
    workspaceId: string;
    channelId: string;
    qr: string;
    expiresAt: number;
};

export type ConnectionUpdatePayload = {
    workspaceId: string;
    channelId: string;
    status: WAConnectionStatus;
    healthStatus: WAHealthStatus;
    message?: string;
};

export type NewMessagePayload = {
    workspaceId: string;
    channelId: string;
    phoneNumber: string;
    messageText: string;
    messageId: string;
    pushName?: string;
    timestamp: number;
};

/**
 * Global event bus for WA channel events.
 */
export const waEvents = new EventEmitter();
waEvents.setMaxListeners(200);

const latestQrByChannel = new Map<string, QrEventPayload>();
const latestConnectionByChannel = new Map<string, ConnectionUpdatePayload>();

export function emitQr(payload: QrEventPayload) {
    latestQrByChannel.set(payload.channelId, payload);
    waEvents.emit("qr", payload);
}

export function emitConnectionUpdate(payload: ConnectionUpdatePayload) {
    latestConnectionByChannel.set(payload.channelId, payload);
    waEvents.emit("connection-update", payload);
}

export function emitNewMessage(payload: NewMessagePayload) {
    waEvents.emit("new-message", payload);
}

export function getLatestQr(channelId?: string) {
    if (channelId) {
        return latestQrByChannel.get(channelId)?.qr ?? null;
    }

    const latest = Array.from(latestQrByChannel.values())
        .sort((a, b) => b.expiresAt - a.expiresAt)[0];
    return latest?.qr ?? null;
}

export function getLatestQrPayload(channelId: string) {
    return latestQrByChannel.get(channelId) ?? null;
}

export function clearLatestQr(channelId?: string) {
    if (channelId) {
        latestQrByChannel.delete(channelId);
        return;
    }

    latestQrByChannel.clear();
}

export function getLatestConnectionStatus(channelId?: string): WAConnectionStatus {
    if (channelId) {
        return latestConnectionByChannel.get(channelId)?.status ?? "close";
    }

    const latest = Array.from(latestConnectionByChannel.values())
        .sort((a, b) => Number(b.status === "open") - Number(a.status === "open"))[0];
    return latest?.status ?? "close";
}

export function getLatestConnectionSnapshots(workspaceId?: string): ConnectionUpdatePayload[] {
    const values = Array.from(latestConnectionByChannel.values());
    if (!workspaceId) {
        return values;
    }

    return values.filter((item) => item.workspaceId === workspaceId);
}

export interface WAEventMap {
    qr: QrEventPayload;
    "connection-update": ConnectionUpdatePayload;
    "new-message": NewMessagePayload;
}
