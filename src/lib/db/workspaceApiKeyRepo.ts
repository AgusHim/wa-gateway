import crypto from "crypto";
import { ApiKeyStatus } from "@prisma/client";
import { prisma } from "./client";
import { hashToken } from "@/lib/security/token";
import { assertTenantScope } from "@/lib/tenant/context";

export const DEFAULT_PUBLIC_API_SCOPES = [
    "messages:send",
    "contacts:write",
    "conversations:read",
    "usage:read",
] as const;

function buildRawApiKey(): { rawKey: string; prefix: string } {
    const token = crypto.randomBytes(32).toString("hex");
    const prefix = `wgk_${token.slice(0, 10)}`;
    const rawKey = `${prefix}_${token}`;
    return { rawKey, prefix };
}

function hasAllScopes(granted: string[], required: string[]): boolean {
    if (required.length === 0) return true;
    if (granted.includes("*")) return true;
    return required.every((scope) => granted.includes(scope));
}

function parsePrefix(rawKey: string): string | null {
    const value = rawKey.trim();
    if (!value.startsWith("wgk_")) {
        return null;
    }
    const parts = value.split("_");
    if (parts.length < 3) {
        return null;
    }
    return `${parts[0]}_${parts[1]}`;
}

export const workspaceApiKeyRepo = {
    async listKeys(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.workspaceApiKey.findMany({
            where: { workspaceId: resolvedWorkspaceId },
            orderBy: [{ createdAt: "desc" }],
        });
    },

    async createKey(input: {
        workspaceId: string;
        name: string;
        scopes?: string[];
        expiresAt?: Date | null;
        createdByUserId?: string;
    }) {
        const workspaceId = assertTenantScope(input.workspaceId);
        const scopes = Array.from(
            new Set((input.scopes || [...DEFAULT_PUBLIC_API_SCOPES]).map((scope) => scope.trim()).filter(Boolean))
        );
        const { rawKey, prefix } = buildRawApiKey();
        const keyHash = hashToken(rawKey);

        const record = await prisma.workspaceApiKey.create({
            data: {
                workspaceId,
                name: input.name.trim(),
                keyPrefix: prefix,
                keyHash,
                scopes,
                status: ApiKeyStatus.ACTIVE,
                expiresAt: input.expiresAt ?? null,
                createdByUserId: input.createdByUserId,
            },
        });

        return { record, rawKey };
    },

    async revokeKey(workspaceId: string, keyId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const found = await prisma.workspaceApiKey.findFirst({
            where: {
                id: keyId,
                workspaceId: resolvedWorkspaceId,
            },
            select: { id: true },
        });

        if (!found) {
            throw new Error("API key not found");
        }

        return prisma.workspaceApiKey.update({
            where: { id: found.id },
            data: {
                status: ApiKeyStatus.REVOKED,
                revokedAt: new Date(),
            },
        });
    },

    async rotateKey(workspaceId: string, keyId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const found = await prisma.workspaceApiKey.findFirst({
            where: {
                id: keyId,
                workspaceId: resolvedWorkspaceId,
            },
            select: { id: true },
        });

        if (!found) {
            throw new Error("API key not found");
        }

        const { rawKey, prefix } = buildRawApiKey();
        const keyHash = hashToken(rawKey);
        const record = await prisma.workspaceApiKey.update({
            where: { id: found.id },
            data: {
                keyPrefix: prefix,
                keyHash,
                status: ApiKeyStatus.ACTIVE,
                revokedAt: null,
                lastUsedAt: null,
            },
        });

        return { record, rawKey };
    },

    async authenticate(rawKey: string, requiredScopes: string[] = []) {
        const prefix = parsePrefix(rawKey);
        if (!prefix) {
            return null;
        }

        const now = new Date();
        const candidates = await prisma.workspaceApiKey.findMany({
            where: {
                keyPrefix: prefix,
                status: ApiKeyStatus.ACTIVE,
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: now } },
                ],
            },
            take: 5,
        });
        if (candidates.length === 0) {
            return null;
        }

        const incomingHash = hashToken(rawKey.trim());
        for (const key of candidates) {
            const same = crypto.timingSafeEqual(Buffer.from(key.keyHash), Buffer.from(incomingHash));
            if (!same) {
                continue;
            }

            if (!hasAllScopes(key.scopes, requiredScopes)) {
                return {
                    ok: false as const,
                    reason: "insufficient_scope",
                    key,
                };
            }

            await prisma.workspaceApiKey.update({
                where: { id: key.id },
                data: { lastUsedAt: new Date() },
            });

            return {
                ok: true as const,
                key,
            };
        }

        return null;
    },
};
