export type InstagramRetentionPolicy = {
    dmRetentionDays: number;
    commentRetentionDays: number;
    mediaMetadataRetentionDays: number;
};

export const INSTAGRAM_USER_IDENTIFIER_PREFIX = "ig:";

function parseRetentionEnv(name: string, fallback: number, min: number, max: number): number {
    const parsed = Number(process.env[name]);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function resolveInstagramRetentionPolicy(): InstagramRetentionPolicy {
    return {
        dmRetentionDays: parseRetentionEnv("INSTAGRAM_DM_RETENTION_DAYS", 365, 1, 3650),
        commentRetentionDays: parseRetentionEnv("INSTAGRAM_COMMENT_RETENTION_DAYS", 180, 1, 3650),
        mediaMetadataRetentionDays: parseRetentionEnv("INSTAGRAM_MEDIA_METADATA_RETENTION_DAYS", 90, 1, 3650),
    };
}

export function isInstagramScopedUserIdentifier(value: string | null | undefined): boolean {
    return typeof value === "string" && value.trim().toLowerCase().startsWith(INSTAGRAM_USER_IDENTIFIER_PREFIX);
}
