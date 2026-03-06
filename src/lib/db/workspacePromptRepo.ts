import { prisma } from "@/lib/db/client";
import { assertTenantScope } from "@/lib/tenant/context";
import { loadAllInstructions } from "@/lib/instructions/loader";

export type WorkspacePromptPayload = {
    identity: string;
    behavior: string;
    skills: string;
    tools?: string;
    memory?: string;
};

function normalizePayload(payload: WorkspacePromptPayload): WorkspacePromptPayload {
    return {
        identity: payload.identity.trim(),
        behavior: payload.behavior.trim(),
        skills: payload.skills.trim(),
        tools: payload.tools?.trim() || "",
        memory: payload.memory?.trim() || "",
    };
}

export const workspacePromptRepo = {
    async ensureDefaultPromptVersion(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const existing = await prisma.workspacePromptVersion.findFirst({
            where: { workspaceId: resolvedWorkspaceId },
            orderBy: { version: "asc" },
        });

        if (existing) {
            return existing;
        }

        const instructions = loadAllInstructions();

        return prisma.workspacePromptVersion.create({
            data: {
                workspaceId: resolvedWorkspaceId,
                version: 1,
                title: "Default Prompt v1",
                identity: instructions.identity,
                behavior: instructions.behavior,
                skills: instructions.skills,
                tools: instructions.tools,
                memory: instructions.memory,
                isActive: true,
            },
        });
    },

    async getActivePromptVersion(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        await this.ensureDefaultPromptVersion(resolvedWorkspaceId);

        return prisma.workspacePromptVersion.findFirst({
            where: {
                workspaceId: resolvedWorkspaceId,
                isActive: true,
            },
            orderBy: { version: "desc" },
        });
    },

    async listPromptVersions(workspaceId: string, limit: number = 20) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.workspacePromptVersion.findMany({
            where: { workspaceId: resolvedWorkspaceId },
            orderBy: { version: "desc" },
            take: Math.max(1, Math.min(100, Math.round(limit))),
        });
    },

    async createPromptVersion(input: {
        workspaceId: string;
        title?: string;
        payload: WorkspacePromptPayload;
        createdByUserId?: string;
        activate?: boolean;
    }) {
        const resolvedWorkspaceId = assertTenantScope(input.workspaceId);
        const payload = normalizePayload(input.payload);

        const latest = await prisma.workspacePromptVersion.findFirst({
            where: { workspaceId: resolvedWorkspaceId },
            orderBy: { version: "desc" },
            select: { version: true },
        });

        const nextVersion = (latest?.version ?? 0) + 1;

        const created = await prisma.workspacePromptVersion.create({
            data: {
                workspaceId: resolvedWorkspaceId,
                version: nextVersion,
                title: input.title?.trim() || `Prompt v${nextVersion}`,
                identity: payload.identity,
                behavior: payload.behavior,
                skills: payload.skills,
                tools: payload.tools,
                memory: payload.memory,
                isActive: input.activate !== false,
                createdByUserId: input.createdByUserId,
            },
        });

        if (created.isActive) {
            await prisma.workspacePromptVersion.updateMany({
                where: {
                    workspaceId: resolvedWorkspaceId,
                    id: { not: created.id },
                },
                data: { isActive: false },
            });
        }

        return created;
    },

    async activatePromptVersion(workspaceId: string, versionId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);

        const prompt = await prisma.workspacePromptVersion.findFirst({
            where: {
                id: versionId,
                workspaceId: resolvedWorkspaceId,
            },
        });

        if (!prompt) {
            throw new Error("Prompt version not found");
        }

        await prisma.workspacePromptVersion.updateMany({
            where: { workspaceId: resolvedWorkspaceId },
            data: { isActive: false },
        });

        return prisma.workspacePromptVersion.update({
            where: { id: prompt.id },
            data: { isActive: true },
        });
    },
};
