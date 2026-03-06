import { createHash, randomBytes } from "crypto";

export function generateRawToken(bytes: number = 32): string {
    return randomBytes(bytes).toString("base64url");
}

export function hashToken(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
}
