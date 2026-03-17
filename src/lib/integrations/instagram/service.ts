import crypto from "crypto";
import { ChannelHealthStatus } from "@prisma/client";
import { channelRepo } from "@/lib/db/channelRepo";
import { isInstagramProvider } from "@/lib/channel/provider";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import {
    buildInstagramOauthUrl,
    computeTokenExpiryIso,
    exchangeCodeForUserToken,
    exchangeLongLivedUserToken,
    fetchInstagramGraphBinding,
    isMetaTokenInvalidError,
} from "./oauth";
import { getInstagramIntegrationConfig, resolveAppBaseUrl } from "./config";
import { assertInstagramLaunchModeAllowsWorkspace } from "./launchMode";
import { instagramRepo } from "./repo";

function buildRedirectPath(path?: string): string {
    const normalized = path?.trim();
    if (!normalized || !normalized.startsWith("/")) {
        return "/channels";
    }

    return normalized;
}

function resolveInstagramRedirectUri(origin?: string): string {
    const config = getInstagramIntegrationConfig();
    if (config?.redirectUriOverride) {
        return config.redirectUriOverride;
    }

    return `${resolveAppBaseUrl(origin)}/api/instagram/oauth/callback`;
}

function extractPreferredInstagramAccountId(identifier?: string | null): string | undefined {
    const value = identifier?.trim();
    if (!value) return undefined;

    if (/^\d+$/.test(value)) {
        return value;
    }

    const withPrefix = value.toLowerCase().startsWith("ig:") ? value.slice(3) : value;
    return /^\d+$/.test(withPrefix) ? withPrefix : undefined;
}

export async function beginInstagramChannelConnect(input: {
    workspaceId: string;
    userId: string;
    channelId: string;
    returnPath?: string;
    origin?: string;
}): Promise<{ authUrl: string; state: string }> {
    const config = getInstagramIntegrationConfig();
    if (!config) {
        throw new Error("Instagram integration belum dikonfigurasi (INSTAGRAM_APP_ID/INSTAGRAM_APP_SECRET)");
    }

    assertInstagramLaunchModeAllowsWorkspace(input.workspaceId);

    const channel = await channelRepo.getWorkspaceChannel(input.workspaceId, input.channelId);
    if (!channel) {
        throw new Error("Channel not found");
    }
    if (!isInstagramProvider(channel.provider)) {
        throw new Error("Channel provider must be instagram");
    }

    const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomBytes(8).toString("hex");
    const redirectUri = resolveInstagramRedirectUri(input.origin);
    await instagramRepo.saveOauthState(state, {
        workspaceId: input.workspaceId,
        userId: input.userId,
        channelId: input.channelId,
        returnPath: buildRedirectPath(input.returnPath),
        origin: input.origin,
    });

    return {
        state,
        authUrl: buildInstagramOauthUrl({
            state,
            redirectUri,
        }),
    };
}

export async function completeInstagramOauth(input: {
    code: string;
    state: string;
    fallbackOrigin?: string;
}): Promise<{
    workspaceId: string;
    channelId: string;
    returnPath: string;
}> {
    const oauthState = await instagramRepo.consumeOauthState(input.state);
    if (!oauthState) {
        throw new Error("OAuth state tidak valid atau sudah kedaluwarsa");
    }

    const channel = await channelRepo.getWorkspaceChannel(oauthState.workspaceId, oauthState.channelId);
    if (!channel) {
        throw new Error("Channel tidak ditemukan");
    }
    if (!isInstagramProvider(channel.provider)) {
        throw new Error("Channel provider bukan instagram");
    }

    const redirectUri = resolveInstagramRedirectUri(oauthState.origin || input.fallbackOrigin);
    const shortToken = await exchangeCodeForUserToken({
        code: input.code,
        redirectUri,
    });

    let finalToken = shortToken;
    try {
        finalToken = await exchangeLongLivedUserToken(shortToken.accessToken);
    } catch (error) {
        logWarn("instagram.oauth.long_lived_exchange_failed", {
            workspaceId: oauthState.workspaceId,
            channelId: oauthState.channelId,
            reason: error instanceof Error ? error.message : String(error),
        });
    }

    const binding = await fetchInstagramGraphBinding({
        accessToken: finalToken.accessToken,
        preferredInstagramAccountId: extractPreferredInstagramAccountId(channel.identifier),
    });

    await instagramRepo.upsertChannelCredential({
        workspaceId: oauthState.workspaceId,
        channelId: oauthState.channelId,
        accessToken: finalToken.accessToken,
        pageId: binding.pageId,
        pageName: binding.pageName,
        instagramAccountId: binding.instagramAccountId,
        instagramUsername: binding.instagramUsername,
        appScopedUserId: binding.appScopedUserId,
        scopes: getInstagramIntegrationConfig()?.oauthScopes || [],
        tokenType: finalToken.tokenType || shortToken.tokenType,
        expiresAt: computeTokenExpiryIso(finalToken.expiresIn || shortToken.expiresIn),
        status: "connected",
        createdByUserId: oauthState.userId,
    });

    await channelRepo.updateHealth(oauthState.channelId, {
        healthStatus: ChannelHealthStatus.CONNECTED,
        healthScore: 100,
        status: "active",
        message: "instagram_connected",
        markSeen: true,
    });

    await channelRepo.createAudit(oauthState.channelId, {
        eventType: "instagram_oauth_connected",
        status: "success",
        message: `instagram=${binding.instagramUsername || binding.instagramAccountId}`,
        metadata: {
            pageId: binding.pageId,
            pageName: binding.pageName,
            instagramAccountId: binding.instagramAccountId,
            instagramUsername: binding.instagramUsername,
            appScopedUserId: binding.appScopedUserId,
        },
    });

    logInfo("instagram.oauth.connected", {
        workspaceId: oauthState.workspaceId,
        channelId: oauthState.channelId,
        pageId: binding.pageId,
        instagramAccountId: binding.instagramAccountId,
    });

    return {
        workspaceId: oauthState.workspaceId,
        channelId: oauthState.channelId,
        returnPath: buildRedirectPath(oauthState.returnPath),
    };
}

export async function refreshInstagramChannelToken(input: {
    workspaceId: string;
    channelId: string;
    triggeredBy?: string;
    createdByUserId?: string;
}): Promise<void> {
    const channel = await channelRepo.getWorkspaceChannel(input.workspaceId, input.channelId);
    if (!channel) {
        throw new Error("Channel not found");
    }
    if (!isInstagramProvider(channel.provider)) {
        throw new Error("Channel provider must be instagram");
    }

    const credential = await instagramRepo.getChannelCredential(input.workspaceId, input.channelId);
    if (!credential) {
        throw new Error("Instagram credential not found. Connect channel first.");
    }

    try {
        const refreshed = await exchangeLongLivedUserToken(credential.accessToken);
        await instagramRepo.updateChannelCredentialMetadata({
            workspaceId: input.workspaceId,
            channelId: input.channelId,
            accessToken: refreshed.accessToken,
            patch: {
                tokenType: refreshed.tokenType || credential.metadata.tokenType,
                expiresAt: computeTokenExpiryIso(refreshed.expiresIn) || credential.metadata.expiresAt,
                status: "connected",
                lastError: undefined,
                lastRefreshedAt: new Date().toISOString(),
            },
            createdByUserId: input.createdByUserId,
        });

        await channelRepo.updateHealth(input.channelId, {
            healthStatus: ChannelHealthStatus.CONNECTED,
            healthScore: 100,
            status: "active",
            message: "instagram_token_refreshed",
            markSeen: true,
        });

        await channelRepo.createAudit(input.channelId, {
            eventType: "instagram_token_refreshed",
            status: "success",
            message: input.triggeredBy || "manual",
        });

        logInfo("instagram.token_refreshed", {
            workspaceId: input.workspaceId,
            channelId: input.channelId,
            triggeredBy: input.triggeredBy || "manual",
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await instagramRepo.touchInvalidState({
            workspaceId: input.workspaceId,
            channelId: input.channelId,
            reason,
        }).catch(() => null);

        await channelRepo.updateHealth(input.channelId, {
            healthStatus: isMetaTokenInvalidError(error)
                ? ChannelHealthStatus.DISCONNECTED
                : ChannelHealthStatus.DEGRADED,
            healthScore: isMetaTokenInvalidError(error) ? 20 : 45,
            status: "inactive",
            message: `instagram_token_refresh_failed:${reason.slice(0, 120)}`,
        });

        await channelRepo.createAudit(input.channelId, {
            eventType: "instagram_token_refresh_failed",
            status: "error",
            message: reason.slice(0, 300),
        });

        logError("instagram.token_refresh_failed", error, {
            workspaceId: input.workspaceId,
            channelId: input.channelId,
            triggeredBy: input.triggeredBy || "manual",
        });

        throw error;
    }
}

export async function syncInstagramChannelHealth(workspaceId: string, channelId: string) {
    const binding = await instagramRepo.getChannelBinding(workspaceId, channelId);
    if (!binding) {
        await channelRepo.updateHealth(channelId, {
            healthStatus: ChannelHealthStatus.DISCONNECTED,
            healthScore: 20,
            status: "inactive",
            message: "instagram_not_connected",
        });
        return;
    }

    const expiresAtMs = binding.expiresAt ? new Date(binding.expiresAt).getTime() : null;
    const expired = expiresAtMs !== null && Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs;
    const isInvalid = binding.status === "invalid";

    if (isInvalid) {
        await channelRepo.updateHealth(channelId, {
            healthStatus: ChannelHealthStatus.DISCONNECTED,
            healthScore: 20,
            status: "inactive",
            message: binding.lastError || "instagram_invalid_token",
        });
        return;
    }

    if (expired) {
        await channelRepo.updateHealth(channelId, {
            healthStatus: ChannelHealthStatus.DEGRADED,
            healthScore: 45,
            status: "inactive",
            message: "instagram_token_expired",
        });
        return;
    }

    await channelRepo.updateHealth(channelId, {
        healthStatus: ChannelHealthStatus.CONNECTED,
        healthScore: 100,
        status: "active",
        message: "instagram_connected",
        markSeen: true,
    });
}
