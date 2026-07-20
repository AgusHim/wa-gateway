import { createReadStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import {
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";

const DEFAULT_MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const DEFAULT_STORAGE_ROOT = path.join(process.cwd(), ".wa-media");

const DOCUMENT_MIME_TYPES = new Set([
    "application/json",
    "application/msword",
    "application/octet-stream",
    "application/pdf",
    "application/rtf",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
    "text/csv",
    "text/plain",
]);

const AUDIO_MIME_TYPES = new Set([
    "audio/aac",
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg",
    "audio/opus",
    "audio/wav",
    "audio/webm",
    "audio/x-wav",
]);

export type MediaObjectInfo = {
    storageKey: string;
    absolutePath?: string;
    byteSize: number;
};

let s3Client: S3Client | null = null;

type MediaStorageDriver = "local" | "s3" | "r2";

export function resolveMediaStorageDriver(value = process.env.WA_MEDIA_STORAGE_DRIVER): MediaStorageDriver {
    const normalized = value?.trim().toLowerCase();
    if (normalized === "r2" || normalized === "s3") return normalized;
    return "local";
}

export function buildCloudflareR2Endpoint(accountId: string): string {
    const normalized = accountId.trim();
    if (!normalized || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
        throw new Error("WA_MEDIA_R2_ACCOUNT_ID is invalid");
    }
    return `https://${normalized}.r2.cloudflarestorage.com`;
}

function storageDriver(): MediaStorageDriver {
    return resolveMediaStorageDriver();
}

function s3Bucket(): string {
    const driver = storageDriver();
    const bucket = driver === "r2"
        ? process.env.WA_MEDIA_R2_BUCKET?.trim()
        : process.env.WA_MEDIA_S3_BUCKET?.trim();
    if (!bucket) {
        throw new Error(driver === "r2"
            ? "WA_MEDIA_R2_BUCKET is required for R2 media storage"
            : "WA_MEDIA_S3_BUCKET is required for S3 media storage");
    }
    return bucket;
}

function s3ObjectKey(storageKey: string): string {
    const configuredPrefix = storageDriver() === "r2"
        ? process.env.WA_MEDIA_R2_PREFIX
        : process.env.WA_MEDIA_S3_PREFIX;
    const prefix = configuredPrefix?.trim().replace(/^\/+|\/+$/g, "");
    return prefix ? `${prefix}/${storageKey}` : storageKey;
}

function getS3Client(): S3Client {
    if (s3Client) return s3Client;
    const driver = storageDriver();
    const isR2 = driver === "r2";
    const accountId = process.env.WA_MEDIA_R2_ACCOUNT_ID?.trim();
    if (isR2 && !accountId) {
        throw new Error("WA_MEDIA_R2_ACCOUNT_ID is required for R2 media storage");
    }

    const endpoint = isR2
        ? buildCloudflareR2Endpoint(accountId || "")
        : process.env.WA_MEDIA_S3_ENDPOINT?.trim() || undefined;
    const accessKeyId = isR2
        ? process.env.WA_MEDIA_R2_ACCESS_KEY_ID?.trim()
        : process.env.WA_MEDIA_S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = isR2
        ? process.env.WA_MEDIA_R2_SECRET_ACCESS_KEY?.trim()
        : process.env.WA_MEDIA_S3_SECRET_ACCESS_KEY?.trim();
    if (isR2 && (!accessKeyId || !secretAccessKey)) {
        throw new Error("WA_MEDIA_R2_ACCESS_KEY_ID and WA_MEDIA_R2_SECRET_ACCESS_KEY are required for R2 media storage");
    }

    s3Client = new S3Client({
        region: isR2 ? "auto" : process.env.WA_MEDIA_S3_REGION?.trim() || "us-east-1",
        endpoint,
        forcePathStyle: isR2
            ? false
            : endpoint ? process.env.WA_MEDIA_S3_FORCE_PATH_STYLE !== "false" : undefined,
        credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    });
    return s3Client;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.round(parsed);
}

export function getMaxInboundMediaBytes(): number {
    return parsePositiveInt(process.env.WA_MEDIA_MAX_BYTES, DEFAULT_MAX_MEDIA_BYTES);
}

export function normalizeMimeType(value: string | null | undefined): string {
    return value?.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
}

export function isAllowedInboundMime(type: "document" | "audio" | "sticker", mimeType: string): boolean {
    const normalized = normalizeMimeType(mimeType);
    if (type === "audio") return AUDIO_MIME_TYPES.has(normalized);
    if (type === "sticker") return normalized === "image/webp";
    return DOCUMENT_MIME_TYPES.has(normalized);
}

export function sanitizeMediaFileName(value: string | null | undefined, fallback: string): string {
    const baseName = path.basename(value?.trim() || fallback);
    const sanitized = baseName
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .replace(/[^a-zA-Z0-9._() -]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
    return (sanitized || fallback).slice(0, 180);
}

function sanitizeKeySegment(value: string): string {
    const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!sanitized || sanitized === "." || sanitized === "..") {
        throw new Error("Invalid media storage key segment");
    }
    return sanitized;
}

function storageRoot(): string {
    const configured = process.env.WA_MEDIA_STORAGE_ROOT?.trim();
    return path.resolve(configured || DEFAULT_STORAGE_ROOT);
}

function resolveStorageKey(storageKey: string): string {
    const root = storageRoot();
    const normalizedKey = storageKey.replace(/\\/g, "/");
    if (!normalizedKey || normalizedKey.startsWith("/") || normalizedKey.split("/").includes("..")) {
        throw new Error("Invalid media storage key");
    }

    const absolutePath = path.resolve(root, normalizedKey);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
        throw new Error("Media storage key escapes configured root");
    }
    return absolutePath;
}

export async function storePrivateMedia(input: {
    workspaceId: string;
    fileName: string;
    mimeType?: string;
    data: Buffer;
}): Promise<{ storageKey: string; byteSize: number; checksum: string }> {
    const maximum = getMaxInboundMediaBytes();
    if (input.data.byteLength > maximum) {
        throw new Error(`Media exceeds maximum size of ${maximum} bytes`);
    }

    const workspace = sanitizeKeySegment(input.workspaceId);
    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const fileName = sanitizeMediaFileName(input.fileName, "attachment.bin");
    const storageKey = [workspace, String(now.getUTCFullYear()), month, `${randomUUID()}-${fileName}`].join("/");

    const checksum = createHash("sha256").update(input.data).digest("hex");
    if (storageDriver() !== "local") {
        await getS3Client().send(new PutObjectCommand({
            Bucket: s3Bucket(),
            Key: s3ObjectKey(storageKey),
            Body: input.data,
            ContentLength: input.data.byteLength,
            ContentType: input.mimeType ? normalizeMimeType(input.mimeType) : "application/octet-stream",
            Metadata: { sha256: checksum, workspace },
        }));
        return { storageKey, byteSize: input.data.byteLength, checksum };
    }

    const absolutePath = resolveStorageKey(storageKey);
    await mkdir(path.dirname(absolutePath), { recursive: true });

    const handle = await open(absolutePath, "wx", 0o600);
    try {
        await handle.writeFile(input.data);
    } finally {
        await handle.close();
    }

    return {
        storageKey,
        byteSize: input.data.byteLength,
        checksum,
    };
}

export async function getPrivateMediaInfo(storageKey: string): Promise<MediaObjectInfo> {
    if (storageDriver() !== "local") {
        const result = await getS3Client().send(new HeadObjectCommand({
            Bucket: s3Bucket(),
            Key: s3ObjectKey(storageKey),
        }));
        const byteSize = result.ContentLength;
        if (byteSize === undefined || byteSize < 0) throw new Error("S3 media object has no content length");
        return { storageKey, byteSize };
    }

    const absolutePath = resolveStorageKey(storageKey);
    const fileInfo = await stat(absolutePath);
    if (!fileInfo.isFile()) {
        throw new Error("Media object is not a file");
    }
    return { storageKey, absolutePath, byteSize: fileInfo.size };
}

export async function createPrivateMediaStream(
    info: MediaObjectInfo,
    range?: { start: number; end: number }
): Promise<Readable> {
    if (storageDriver() !== "local") {
        const result = await getS3Client().send(new GetObjectCommand({
            Bucket: s3Bucket(),
            Key: s3ObjectKey(info.storageKey),
            Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        }));
        if (!result.Body || !(result.Body instanceof Readable)) {
            throw new Error("S3 media response is not a Node.js readable stream");
        }
        return result.Body;
    }

    if (!info.absolutePath) throw new Error("Local media path is unavailable");
    return createReadStream(info.absolutePath, range);
}
