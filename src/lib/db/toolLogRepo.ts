import { prisma } from "./client";
import { Prisma } from "@prisma/client";

export const toolLogRepo = {
    async saveToolLog(data: {
        toolName: string;
        input: Record<string, unknown>;
        output?: Record<string, unknown>;
        success: boolean;
        duration: number;
    }) {
        return prisma.toolLog.create({
            data: {
                ...data,
                input: data.input as Prisma.InputJsonValue,
                output: data.output as Prisma.InputJsonValue ?? Prisma.JsonNull,
            },
        });

    },

    async getToolLogs(filter?: {
        toolName?: string;
        success?: boolean;
        limit?: number;
    }) {
        return prisma.toolLog.findMany({
            where: {
                toolName: filter?.toolName,
                success: filter?.success,
            },
            orderBy: { createdAt: "desc" },
            take: filter?.limit ?? 100,
        });
    },

    async getDistinctToolNames() {
        const names = await prisma.toolLog.findMany({
            distinct: ["toolName"],
            select: { toolName: true },
            orderBy: { toolName: "asc" },
        });
        return names.map((item) => item.toolName);
    },

    async getToolUsageSummary() {
        return prisma.toolLog.groupBy({
            by: ["toolName"],
            _count: { toolName: true },
            orderBy: {
                _count: { toolName: "desc" },
            },
        });
    },
};
