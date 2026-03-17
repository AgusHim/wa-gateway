import { InstagramTokenStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { assertTenantScope } from "@/lib/tenant/context";

function normalizeOptionalString(value?: string | null): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    const normalized = value.trim();
    return normalized || undefined;
}

function normalizeWebhookFields(fields?: string[] | null): string[] {
    if (!fields || fields.length === 0) {
        return [];
    }

    return Array.from(new Set(fields.map((item) => item.trim()).filter(Boolean)));
}

function hasOwnField(value: object, field: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, field);
}

const instagramChannelConfigSelect = Prisma.validator<Prisma.InstagramChannelConfigSelect>()({
    id: true,
    workspaceId: true,
    channelId: true,
    appScopedUserId: true,
    pageId: true,
    pageName: true,
    instagramAccountId: true,
    instagramUsername: true,
    webhookFields: true,
    webhookSubscribedAt: true,
    credentialName: true,
    tokenStatus: true,
    tokenExpiresAt: true,
    tokenLastRefreshAt: true,
    lastWebhookAt: true,
    metadata: true,
    createdAt: true,
    updatedAt: true,
});

export type InstagramChannelConfigRecord = Prisma.InstagramChannelConfigGetPayload<{
    select: typeof instagramChannelConfigSelect;
}>;

export const instagramChannelRepo = {
    async upsertConfig(input: {
        workspaceId: string;
        channelId: string;
        appScopedUserId?: string;
        pageId: string;
        pageName?: string;
        instagramAccountId: string;
        instagramUsername?: string;
        webhookFields?: string[];
        webhookSubscribedAt?: Date | null;
        credentialName: string;
        tokenStatus?: InstagramTokenStatus;
        tokenExpiresAt?: Date | null;
        tokenLastRefreshAt?: Date | null;
        lastWebhookAt?: Date | null;
        metadata?: Record<string, unknown> | null;
    }): Promise<InstagramChannelConfigRecord> {
        const workspaceId = assertTenantScope(input.workspaceId);
        const channelId = input.channelId.trim();
        if (!channelId) {
            throw new Error("channelId is required");
        }

        const pageId = input.pageId.trim();
        if (!pageId) {
            throw new Error("pageId is required");
        }

        const instagramAccountId = input.instagramAccountId.trim();
        if (!instagramAccountId) {
            throw new Error("instagramAccountId is required");
        }

        const credentialName = input.credentialName.trim();
        if (!credentialName) {
            throw new Error("credentialName is required");
        }

        const channel = await prisma.channel.findFirst({
            where: {
                id: channelId,
                workspaceId,
            },
            select: {
                id: true,
            },
        });

        if (!channel) {
            throw new Error("Channel not found in workspace");
        }

        const updateData: Prisma.InstagramChannelConfigUpdateInput = {
            pageId,
            instagramAccountId,
            credentialName,
            tokenExpiresAt: input.tokenExpiresAt ?? undefined,
            tokenLastRefreshAt: input.tokenLastRefreshAt ?? undefined,
            lastWebhookAt: input.lastWebhookAt ?? undefined,
        };

        if (hasOwnField(input, "appScopedUserId")) {
            updateData.appScopedUserId = normalizeOptionalString(input.appScopedUserId) || null;
        }
        if (hasOwnField(input, "pageName")) {
            updateData.pageName = normalizeOptionalString(input.pageName) || null;
        }
        if (hasOwnField(input, "instagramUsername")) {
            updateData.instagramUsername = normalizeOptionalString(input.instagramUsername) || null;
        }
        if (hasOwnField(input, "webhookFields")) {
            updateData.webhookFields = normalizeWebhookFields(input.webhookFields);
        }
        if (hasOwnField(input, "webhookSubscribedAt")) {
            updateData.webhookSubscribedAt = input.webhookSubscribedAt ?? null;
        }
        if (hasOwnField(input, "metadata")) {
            updateData.metadata = (input.metadata as Prisma.InputJsonValue | null | undefined) ?? Prisma.JsonNull;
        }
        if (hasOwnField(input, "tokenStatus")) {
            updateData.tokenStatus = input.tokenStatus || InstagramTokenStatus.CONNECTED;
        }

        return prisma.instagramChannelConfig.upsert({
            where: {
                channelId,
            },
            update: updateData,
            create: {
                workspaceId,
                channelId,
                appScopedUserId: normalizeOptionalString(input.appScopedUserId) || null,
                pageId,
                pageName: normalizeOptionalString(input.pageName) || null,
                instagramAccountId,
                instagramUsername: normalizeOptionalString(input.instagramUsername) || null,
                webhookFields: normalizeWebhookFields(input.webhookFields),
                webhookSubscribedAt: input.webhookSubscribedAt ?? null,
                credentialName,
                tokenStatus: input.tokenStatus || InstagramTokenStatus.CONNECTED,
                tokenExpiresAt: input.tokenExpiresAt ?? null,
                tokenLastRefreshAt: input.tokenLastRefreshAt ?? null,
                lastWebhookAt: input.lastWebhookAt ?? null,
                metadata: (input.metadata as Prisma.InputJsonValue | null | undefined) ?? Prisma.JsonNull,
            },
            select: instagramChannelConfigSelect,
        });
    },

    async getWorkspaceChannelConfig(workspaceIdInput: string, channelIdInput: string): Promise<InstagramChannelConfigRecord | null> {
        const workspaceId = assertTenantScope(workspaceIdInput);
        const channelId = channelIdInput.trim();
        if (!channelId) {
            return null;
        }

        return prisma.instagramChannelConfig.findFirst({
            where: {
                workspaceId,
                channelId,
            },
            select: instagramChannelConfigSelect,
        });
    },

    async getByInstagramAccountId(workspaceIdInput: string, instagramAccountIdInput: string): Promise<InstagramChannelConfigRecord | null> {
        const workspaceId = assertTenantScope(workspaceIdInput);
        const instagramAccountId = instagramAccountIdInput.trim();
        if (!instagramAccountId) {
            return null;
        }

        return prisma.instagramChannelConfig.findFirst({
            where: {
                workspaceId,
                instagramAccountId,
            },
            select: instagramChannelConfigSelect,
        });
    },

    async listWorkspaceChannelConfigs(workspaceIdInput: string): Promise<InstagramChannelConfigRecord[]> {
        const workspaceId = assertTenantScope(workspaceIdInput);
        return prisma.instagramChannelConfig.findMany({
            where: {
                workspaceId,
            },
            orderBy: [
                { updatedAt: "desc" },
                { channelId: "asc" },
            ],
            select: instagramChannelConfigSelect,
        });
    },

    async deleteWorkspaceChannelConfig(workspaceIdInput: string, channelIdInput: string): Promise<boolean> {
        const workspaceId = assertTenantScope(workspaceIdInput);
        const channelId = channelIdInput.trim();
        if (!channelId) {
            return false;
        }

        const result = await prisma.instagramChannelConfig.deleteMany({
            where: {
                workspaceId,
                channelId,
            },
        });

        return result.count > 0;
    },
};
