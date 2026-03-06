import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { assertTenantScope } from "@/lib/tenant/context";
import {
    decryptString,
    encryptString,
    packEncryptedPayload,
    unpackEncryptedPayload,
} from "@/lib/security/crypto";

export const workspaceCredentialRepo = {
    async listCredentialMetas(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);

        return prisma.workspaceCredential.findMany({
            where: { workspaceId: resolvedWorkspaceId },
            orderBy: [{ provider: "asc" }, { name: "asc" }],
            select: {
                id: true,
                workspaceId: true,
                provider: true,
                name: true,
                metadata: true,
                createdByUserId: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    },

    async upsertCredential(input: {
        workspaceId: string;
        provider: string;
        name: string;
        secret: string;
        metadata?: Record<string, unknown>;
        createdByUserId?: string;
    }) {
        const resolvedWorkspaceId = assertTenantScope(input.workspaceId);
        const provider = input.provider.trim() || "custom";
        const name = input.name.trim();
        if (!name) {
            throw new Error("Credential name is required");
        }

        const secret = input.secret;
        if (!secret.trim()) {
            throw new Error("Credential secret is required");
        }

        const encryptedPayload = encryptString(secret);
        const encryptedValue = packEncryptedPayload(encryptedPayload);

        return prisma.workspaceCredential.upsert({
            where: {
                workspaceId_name: {
                    workspaceId: resolvedWorkspaceId,
                    name,
                },
            },
            update: {
                provider,
                encryptedValue,
                metadata: input.metadata as Prisma.InputJsonValue ?? Prisma.JsonNull,
                createdByUserId: input.createdByUserId,
            },
            create: {
                workspaceId: resolvedWorkspaceId,
                provider,
                name,
                encryptedValue,
                metadata: input.metadata as Prisma.InputJsonValue ?? Prisma.JsonNull,
                createdByUserId: input.createdByUserId,
            },
        });
    },

    async deleteCredential(workspaceId: string, name: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const normalizedName = name.trim();

        const result = await prisma.workspaceCredential.deleteMany({
            where: {
                workspaceId: resolvedWorkspaceId,
                name: normalizedName,
            },
        });

        if (result.count === 0) {
            throw new Error("Credential not found");
        }
    },

    async getCredentialSecret(workspaceId: string, name: string): Promise<string | null> {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const normalizedName = name.trim();
        if (!normalizedName) return null;

        const credential = await prisma.workspaceCredential.findFirst({
            where: {
                workspaceId: resolvedWorkspaceId,
                name: normalizedName,
            },
            select: {
                encryptedValue: true,
            },
        });

        if (!credential) {
            return null;
        }

        const payload = unpackEncryptedPayload(credential.encryptedValue);
        return decryptString(payload);
    },
};
