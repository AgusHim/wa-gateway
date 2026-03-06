import { prisma } from "./client";
import { assertTenantScope } from "@/lib/tenant/context";
import { RuntimeCache } from "@/lib/cache/runtimeCache";
import { invalidateWorkspaceRuntimeFlags } from "@/lib/tenant/flags";
import type { WorkspaceConfig } from "@prisma/client";

const botConfigCache = new RuntimeCache<WorkspaceConfig>(30_000);

function configCacheKey(workspaceId: string): string {
    return `bot-config:${workspaceId}`;
}

export const configRepo = {
    async getBotConfig(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);

        const key = configCacheKey(resolvedWorkspaceId);
        return botConfigCache.getOrLoad(key, async () => {
            let config = await prisma.workspaceConfig.findUnique({
                where: { workspaceId: resolvedWorkspaceId },
            });

            if (!config) {
                config = await prisma.workspaceConfig.create({
                    data: { workspaceId: resolvedWorkspaceId },
                });
            }

            return config;
        });
    },

    async updateBotConfig(workspaceId: string, data: {
        isActive?: boolean;
        model?: string;
        maxTokens?: number;
        temperature?: number;
        safetyProfile?: string;
        fallbackModels?: string[];
        memoryRetentionDays?: number;
        piiRedactionEnabled?: boolean;
        timezone?: string;
        businessHoursStart?: string;
        businessHoursEnd?: string;
        businessDays?: number[];
        outOfHoursAutoReplyEnabled?: boolean;
        outOfHoursMessage?: string;
    }) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);

        const normalizedFallbackModels = Array.isArray(data.fallbackModels)
            ? Array.from(new Set(data.fallbackModels.map((item) => item.trim()).filter(Boolean)))
            : undefined;

        const updated = await prisma.workspaceConfig.upsert({
            where: { workspaceId: resolvedWorkspaceId },
            update: {
                ...data,
                fallbackModels: normalizedFallbackModels ?? data.fallbackModels,
                timezone: data.timezone?.trim() || data.timezone,
                businessHoursStart: data.businessHoursStart?.trim() || data.businessHoursStart,
                businessHoursEnd: data.businessHoursEnd?.trim() || data.businessHoursEnd,
                outOfHoursMessage: data.outOfHoursMessage?.trim() || data.outOfHoursMessage,
            },
            create: {
                workspaceId: resolvedWorkspaceId,
                ...data,
                fallbackModels: normalizedFallbackModels ?? data.fallbackModels,
                timezone: data.timezone?.trim() || data.timezone,
                businessHoursStart: data.businessHoursStart?.trim() || data.businessHoursStart,
                businessHoursEnd: data.businessHoursEnd?.trim() || data.businessHoursEnd,
                outOfHoursMessage: data.outOfHoursMessage?.trim() || data.outOfHoursMessage,
            },
        });

        botConfigCache.set(configCacheKey(resolvedWorkspaceId), updated);
        invalidateWorkspaceRuntimeFlags(resolvedWorkspaceId);
        return updated;
    },
};
