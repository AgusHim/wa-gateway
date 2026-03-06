import crypto from "crypto";

const KEY_ENV = process.env.CREDENTIAL_VAULT_KEY || process.env.NEXTAUTH_SECRET || "";

function buildKey(secret: string): Buffer {
    if (!secret.trim()) {
        throw new Error("CREDENTIAL_VAULT_KEY or NEXTAUTH_SECRET is required for credential encryption");
    }

    return crypto.createHash("sha256").update(secret).digest();
}

const ENCRYPTION_KEY = buildKey(KEY_ENV);
const ALGORITHM = "aes-256-gcm";

export type EncryptedPayload = {
    iv: string;
    tag: string;
    ciphertext: string;
};

export function encryptString(plainText: string): EncryptedPayload {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        ciphertext: encrypted.toString("base64"),
    };
}

export function decryptString(payload: EncryptedPayload): string {
    const iv = Buffer.from(payload.iv, "base64");
    const tag = Buffer.from(payload.tag, "base64");
    const ciphertext = Buffer.from(payload.ciphertext, "base64");

    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
}

export function packEncryptedPayload(payload: EncryptedPayload): string {
    return JSON.stringify(payload);
}

export function unpackEncryptedPayload(serialized: string): EncryptedPayload {
    const parsed = JSON.parse(serialized) as Partial<EncryptedPayload>;
    if (!parsed.iv || !parsed.tag || !parsed.ciphertext) {
        throw new Error("Invalid encrypted payload format");
    }

    return {
        iv: parsed.iv,
        tag: parsed.tag,
        ciphertext: parsed.ciphertext,
    };
}
