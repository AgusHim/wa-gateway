import { decryptString, encryptString, packEncryptedPayload, unpackEncryptedPayload } from "./crypto";

const SESSION_CIPHER_PREFIX = "enc:v1:";

export function encryptStoredSessionData(value: string): string {
    return `${SESSION_CIPHER_PREFIX}${packEncryptedPayload(encryptString(value))}`;
}

export function decryptStoredSessionData(value: string): string {
    if (!value.startsWith(SESSION_CIPHER_PREFIX)) {
        return value;
    }

    const payload = value.slice(SESSION_CIPHER_PREFIX.length);
    return decryptString(unpackEncryptedPayload(payload));
}
