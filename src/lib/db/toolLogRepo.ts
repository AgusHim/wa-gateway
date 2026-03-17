import { prisma } from "./client";
import { Prisma } from "@prisma/client";
import { assertTenantScope } from "@/lib/tenant/context";
import { maybeRedactPii } from "@/lib/security/pii";
import { configRepo } from "./configRepo";

export const toolLogRepo = {
    async saveToolLog(data: {
        workspaceId: string;
        toolName: string;
        input: Record<string, unknown>;
        output?: Record<string, unknown>;
        success: boolean;
        duration: number;
    }) {
        const resolvedWorkspaceId = assertTenantScope(data.workspaceId);
        const config = await configRepo.getBotConfig(resolvedWorkspaceId);
        const piiRedactionEnabled = config.piiRedactionEnabled !== false;
        const sanitizedInput = maybeRedactPii(data.input, piiRedactionEnabled);
        const sanitizedOutput = data.output ? maybeRedactPii(data.output, piiRedactionEnabled) : undefined;
        return prisma.toolLog.create({
            data: {
                ...data,
                workspaceId: resolvedWorkspaceId,
                input: sanitizedInput as Prisma.InputJsonValue,
                output: sanitizedOutput as Prisma.InputJsonValue ?? Prisma.JsonNull,
            },
        });

    },

    async getToolLogs(workspaceId: string, filter?: {
        toolName?: string;
        success?: boolean;
        limit?: number;
    }) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.toolLog.findMany({
            where: {
                workspaceId: resolvedWorkspaceId,
                toolName: filter?.toolName,
                success: filter?.success,
            },
            orderBy: { createdAt: "desc" },
            take: filter?.limit ?? 100,
        });
    },

    async getDistinctToolNames(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const names = await prisma.toolLog.findMany({
            where: { workspaceId: resolvedWorkspaceId },
            distinct: ["toolName"],
            select: { toolName: true },
            orderBy: { toolName: "asc" },
        });
        return names.map((item) => item.toolName);
    },

    async getToolUsageSummary(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.toolLog.groupBy({
            where: { workspaceId: resolvedWorkspaceId },
            by: ["toolName"],
            _count: { toolName: true },
            orderBy: {
                _count: { toolName: "desc" },
            },
        });
    },
};
