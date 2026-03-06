import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(nodeScrypt);

const SALT_BYTES = 16;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
    const normalized = password.trim();
    if (!normalized) {
        throw new Error("Password is required");
    }

    const salt = randomBytes(SALT_BYTES).toString("hex");
    const derived = await scrypt(normalized, salt, KEY_LENGTH) as Buffer;
    return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [algorithm, salt, expectedHex] = storedHash.split("$");
    if (algorithm !== "scrypt" || !salt || !expectedHex) {
        return false;
    }

    const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer;
    const expected = Buffer.from(expectedHex, "hex");

    if (expected.length !== derived.length) {
        return false;
    }

    return timingSafeEqual(expected, derived);
}
