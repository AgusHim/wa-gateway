import crypto from "crypto";
import { redis } from "@/lib/queue/client";

export function buildWebhookSignature(secret: string, timestamp: string, rawBody: string): string {
    const digest = crypto
        .createHmac("sha256", secret)
        .update(`${timestamp}.${rawBody}`)
        .digest("hex");

    return `sha256=${digest}`;
}

export function verifyWebhookSignature(input: {
    secret: string;
    timestamp: string;
    rawBody: string;
    signature: string;
    maxSkewSeconds?: number;
}): boolean {
    const nowSec = Math.floor(Date.now() / 1000);
    const ts = Number(input.timestamp);
    const maxSkew = Math.max(10, input.maxSkewSeconds ?? 5 * 60);
    if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > maxSkew) {
        return false;
    }

    const expected = buildWebhookSignature(input.secret, input.timestamp, input.rawBody);
    if (expected.length !== input.signature.length) {
        return false;
    }

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature));
}

export async function ensureWebhookNotReplay(input: {
    endpointId: string;
    deliveryId: string;
    timestamp: string;
    ttlSeconds?: number;
}): Promise<boolean> {
    const ttl = Math.max(30, input.ttlSeconds ?? 10 * 60);
    const key = `webhook:replay:${input.endpointId}:${input.deliveryId}:${input.timestamp}`;
    const set = await redis.set(key, "1", "EX", ttl, "NX");
    return set === "OK";
}
