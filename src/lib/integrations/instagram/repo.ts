import { InstagramTokenStatus } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { workspaceCredentialRepo } from "@/lib/db/workspaceCredentialRepo";
import { sessionRepo } from "@/lib/db/sessionRepo";
import { assertTenantScope } from "@/lib/tenant/context";
import { instagramChannelRepo, type InstagramChannelConfigRecord } from "./channelRepo";

const INSTAGRAM_CREDENTIAL_PROVIDER = "meta-instagram";
const OAUTH_STATE_PREFIX = "ig:oauth:state";
const DEFAULT_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type BindingStatus = "connected" | "expired" | "invalid";

export type InstagramOauthState = {
    workspaceId: string;
    userId: string;
    channelId: string;
    returnPath?: string;
    origin?: string;
    createdAt: string;
    expiresAt: string;
};

export type InstagramChannelBinding = {
    workspaceId: string;
    channelId: string;
    pageId: string;
    pageName?: string;
    instagramAccountId: string;
    instagramUsername?: string;
    appScopedUserId?: string;
    scopes: string[];
    tokenType?: string;
    expiresAt?: string;
    connectedAt: string;
    updatedAt: string;
    status: BindingStatus;
    lastError?: string;
};

type InstagramCredentialMetadata = {
    channelId: string;
    pageId: string;
    pageName?: string;
    instagramAccountId: string;
    instagramUsername?: string;
    appScopedUserId?: string;
    scopes: string[];
    tokenType?: string;
    expiresAt?: string;
    connectedAt: string;
    updatedAt: string;
    lastRefreshedAt?: string;
    status: BindingStatus;
    lastError?: string;
};

function oauthStateSessionKey(state: string): string {
    return `${OAUTH_STATE_PREFIX}:${state}`;
}

function credentialNameForChannel(channelId: string): string {
    return `instagram:channel:${channelId}:access_token`;
}

function normalizeScopes(scopes: string[] | undefined): string[] {
    return Array.from(new Set((scopes || [])
        .map((item) => item.trim())
        .filter(Boolean)));
}

function normalizeStatus(value: unknown, fallback: BindingStatus = "connected"): BindingStatus {
    if (value === "invalid") {
        return "invalid";
    }
    if (value === "expired") {
        return "expired";
    }
    return fallback;
}

function toTokenStatus(status: BindingStatus): InstagramTokenStatus {
    if (status === "invalid") {
        return InstagramTokenStatus.INVALID;
    }
    if (status === "expired") {
        return InstagramTokenStatus.EXPIRED;
    }
    return InstagramTokenStatus.CONNECTED;
}

function fromTokenStatus(status: InstagramTokenStatus): BindingStatus {
    if (status === InstagramTokenStatus.INVALID) {
        return "invalid";
    }
    if (status === InstagramTokenStatus.EXPIRED) {
        return "expired";
    }
    return "connected";
}

function toDate(value: string | Date | null | undefined): Date | null {
    if (!value) {
        return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        return null;
    }

    return date;
}

function toIso(value: string | Date | null | undefined): string | undefined {
    const date = toDate(value);
    return date ? date.toISOString() : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
    return (value && typeof value === "object" && !Array.isArray(value))
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
}

function hasOwnField(value: object, field: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, field);
}

function readMetadata(value: unknown): InstagramCredentialMetadata | null {
    if (!value || typeof value !== "object") {
        return null;
    }

    const source = value as Record<string, unknown>;
    const channelId = typeof source.channelId === "string" ? source.channelId.trim() : "";
    const pageId = typeof source.pageId === "string" ? source.pageId.trim() : "";
    const instagramAccountId = typeof source.instagramAccountId === "string" ? source.instagramAccountId.trim() : "";
    const connectedAt = typeof source.connectedAt === "string" ? source.connectedAt : "";
    const updatedAt = typeof source.updatedAt === "string" ? source.updatedAt : connectedAt;

    if (!channelId || !pageId || !instagramAccountId || !connectedAt) {
        return null;
    }

    return {
        channelId,
        pageId,
        pageName: typeof source.pageName === "string" ? source.pageName : undefined,
        instagramAccountId,
        instagramUsername: typeof source.instagramUsername === "string" ? source.instagramUsername : undefined,
        appScopedUserId: typeof source.appScopedUserId === "string" ? source.appScopedUserId : undefined,
        scopes: Array.isArray(source.scopes)
            ? source.scopes.filter((item): item is string => typeof item === "string")
            : [],
        tokenType: typeof source.tokenType === "string" ? source.tokenType : undefined,
        expiresAt: typeof source.expiresAt === "string" ? source.expiresAt : undefined,
        connectedAt,
        updatedAt,
        lastRefreshedAt: typeof source.lastRefreshedAt === "string" ? source.lastRefreshedAt : undefined,
        status: normalizeStatus(source.status),
        lastError: typeof source.lastError === "string" ? source.lastError : undefined,
    };
}

function buildMetadataPayload(metadata: InstagramCredentialMetadata): Record<string, unknown> {
    return {
        channelId: metadata.channelId,
        pageId: metadata.pageId,
        pageName: metadata.pageName,
        instagramAccountId: metadata.instagramAccountId,
        instagramUsername: metadata.instagramUsername,
        appScopedUserId: metadata.appScopedUserId,
        scopes: normalizeScopes(metadata.scopes),
        tokenType: metadata.tokenType,
        expiresAt: metadata.expiresAt,
        connectedAt: metadata.connectedAt,
        updatedAt: metadata.updatedAt,
        lastRefreshedAt: metadata.lastRefreshedAt,
        status: metadata.status,
        lastError: metadata.lastError,
    };
}

function mergeConfigAndMetadata(config: InstagramChannelConfigRecord, metadata?: InstagramCredentialMetadata | null): InstagramCredentialMetadata {
    const configMetadata = readRecord(config.metadata);
    const connectedAt = metadata?.connectedAt
        || toIso(readString(configMetadata.connectedAt) || config.createdAt)
        || new Date().toISOString();
    const updatedAt = metadata?.updatedAt
        || toIso(readString(configMetadata.updatedAt) || config.updatedAt)
        || connectedAt;

    return {
        channelId: config.channelId,
        pageId: config.pageId,
        pageName: config.pageName || metadata?.pageName,
        instagramAccountId: config.instagramAccountId,
        instagramUsername: config.instagramUsername || metadata?.instagramUsername,
        appScopedUserId: config.appScopedUserId || metadata?.appScopedUserId,
        scopes: normalizeScopes(
            metadata?.scopes.length
                ? metadata.scopes
                : readStringArray(configMetadata.scopes)
        ),
        tokenType: metadata?.tokenType || readString(configMetadata.tokenType),
        expiresAt: metadata?.expiresAt || toIso(config.tokenExpiresAt),
        connectedAt,
        updatedAt,
        lastRefreshedAt: metadata?.lastRefreshedAt || toIso(config.tokenLastRefreshAt),
        status: normalizeStatus(metadata?.status, fromTokenStatus(config.tokenStatus)),
        lastError: metadata?.lastError || readString(configMetadata.lastError),
    };
}

function toBinding(workspaceId: string, config: InstagramChannelConfigRecord, metadata?: InstagramCredentialMetadata | null): InstagramChannelBinding {
    const resolved = mergeConfigAndMetadata(config, metadata);
    return {
        workspaceId,
        channelId: config.channelId,
        pageId: config.pageId,
        pageName: config.pageName || resolved.pageName,
        instagramAccountId: config.instagramAccountId,
        instagramUsername: config.instagramUsername || resolved.instagramUsername,
        appScopedUserId: config.appScopedUserId || resolved.appScopedUserId,
        scopes: normalizeScopes(resolved.scopes),
        tokenType: resolved.tokenType,
        expiresAt: resolved.expiresAt,
        connectedAt: resolved.connectedAt,
        updatedAt: resolved.updatedAt,
        status: resolved.status,
        lastError: resolved.lastError,
    };
}

function resolveOauthStateTtlMs(): number {
    const raw = Number(process.env.INSTAGRAM_OAUTH_STATE_TTL_MS || DEFAULT_OAUTH_STATE_TTL_MS);
    if (!Number.isFinite(raw)) {
        return DEFAULT_OAUTH_STATE_TTL_MS;
    }
    return Math.max(60_000, Math.min(60 * 60 * 1000, Math.round(raw)));
}

async function findLegacyCredential(workspaceId: string, channelId: string): Promise<{
    name: string;
    metadata: InstagramCredentialMetadata;
} | null> {
    const defaultName = credentialNameForChannel(channelId);
    const rows = await prisma.workspaceCredential.findMany({
        where: {
            workspaceId,
            provider: INSTAGRAM_CREDENTIAL_PROVIDER,
            OR: [
                {
                    name: defaultName,
                },
                {
                    metadata: {
                        path: ["channelId"],
                        equals: channelId,
                    },
                },
            ],
        },
        select: {
            name: true,
            metadata: true,
            updatedAt: true,
        },
        orderBy: {
            updatedAt: "desc",
        },
    });

    for (const row of rows) {
        const metadata = readMetadata(row.metadata);
        if (!metadata) {
            continue;
        }

        if (metadata.channelId !== channelId) {
            continue;
        }

        return {
            name: row.name,
            metadata,
        };
    }

    return null;
}

async function backfillChannelConfigFromLegacy(workspaceId: string, channelId: string): Promise<InstagramChannelConfigRecord | null> {
    const legacy = await findLegacyCredential(workspaceId, channelId);
    if (!legacy) {
        return null;
    }

    try {
        return await instagramChannelRepo.upsertConfig({
            workspaceId,
            channelId,
            appScopedUserId: legacy.metadata.appScopedUserId,
            pageId: legacy.metadata.pageId,
            pageName: legacy.metadata.pageName,
            instagramAccountId: legacy.metadata.instagramAccountId,
            instagramUsername: legacy.metadata.instagramUsername,
            credentialName: legacy.name,
            tokenStatus: toTokenStatus(legacy.metadata.status),
            tokenExpiresAt: toDate(legacy.metadata.expiresAt),
            tokenLastRefreshAt: toDate(legacy.metadata.lastRefreshedAt || legacy.metadata.updatedAt),
            metadata: {
                scopes: legacy.metadata.scopes,
                tokenType: legacy.metadata.tokenType,
                connectedAt: legacy.metadata.connectedAt,
                updatedAt: legacy.metadata.updatedAt,
                lastRefreshedAt: legacy.metadata.lastRefreshedAt,
                lastError: legacy.metadata.lastError,
            },
        });
    } catch {
        return null;
    }
}

async function ensureChannelConfig(workspaceId: string, channelId: string): Promise<InstagramChannelConfigRecord | null> {
    const existing = await instagramChannelRepo.getWorkspaceChannelConfig(workspaceId, channelId);
    if (existing) {
        return existing;
    }

    return backfillChannelConfigFromLegacy(workspaceId, channelId);
}

async function backfillWorkspaceConfigsFromLegacy(workspaceId: string): Promise<void> {
    const rows = await prisma.workspaceCredential.findMany({
        where: {
            workspaceId,
            provider: INSTAGRAM_CREDENTIAL_PROVIDER,
            name: {
                startsWith: "instagram:channel:",
            },
        },
        select: {
            name: true,
            metadata: true,
            updatedAt: true,
        },
        orderBy: {
            updatedAt: "desc",
        },
    });

    for (const row of rows) {
        const metadata = readMetadata(row.metadata);
        if (!metadata) {
            continue;
        }

        await instagramChannelRepo.upsertConfig({
            workspaceId,
            channelId: metadata.channelId,
            appScopedUserId: metadata.appScopedUserId,
            pageId: metadata.pageId,
            pageName: metadata.pageName,
            instagramAccountId: metadata.instagramAccountId,
            instagramUsername: metadata.instagramUsername,
            credentialName: row.name,
            tokenStatus: toTokenStatus(metadata.status),
            tokenExpiresAt: toDate(metadata.expiresAt),
            tokenLastRefreshAt: toDate(metadata.lastRefreshedAt || metadata.updatedAt),
            metadata: {
                scopes: metadata.scopes,
                tokenType: metadata.tokenType,
                connectedAt: metadata.connectedAt,
                updatedAt: metadata.updatedAt,
                lastRefreshedAt: metadata.lastRefreshedAt,
                lastError: metadata.lastError,
            },
        }).catch(() => null);
    }
}

export const instagramRepo = {
    getCredentialNameForChannel(channelId: string) {
        return credentialNameForChannel(channelId.trim());
    },

    async saveOauthState(state: string, input: Omit<InstagramOauthState, "createdAt" | "expiresAt">): Promise<void> {
        const now = Date.now();
        const ttlMs = resolveOauthStateTtlMs();
        const payload: InstagramOauthState = {
            workspaceId: assertTenantScope(input.workspaceId),
            userId: input.userId,
            channelId: input.channelId,
            returnPath: input.returnPath,
            origin: input.origin,
            createdAt: new Date(now).toISOString(),
            expiresAt: new Date(now + ttlMs).toISOString(),
        };

        await sessionRepo.saveSession(oauthStateSessionKey(state), JSON.stringify(payload));
    },

    async consumeOauthState(state: string): Promise<InstagramOauthState | null> {
        const key = oauthStateSessionKey(state.trim());
        const row = await sessionRepo.getSession(key);
        await sessionRepo.deleteSession(key);
        if (!row?.data) {
            return null;
        }

        try {
            const parsed = JSON.parse(row.data) as InstagramOauthState;
            if (!parsed?.workspaceId || !parsed.userId || !parsed.channelId || !parsed.expiresAt) {
                return null;
            }
            if (Date.now() > new Date(parsed.expiresAt).getTime()) {
                return null;
            }

            return {
                ...parsed,
                workspaceId: assertTenantScope(parsed.workspaceId),
            };
        } catch {
            return null;
        }
    },

    async upsertChannelCredential(input: {
        workspaceId: string;
        channelId: string;
        accessToken: string;
        pageId: string;
        pageName?: string;
        instagramAccountId: string;
        instagramUsername?: string;
        appScopedUserId?: string;
        scopes?: string[];
        tokenType?: string;
        expiresAt?: string;
        status?: BindingStatus;
        lastError?: string;
        createdByUserId?: string;
    }): Promise<InstagramChannelBinding> {
        const workspaceId = assertTenantScope(input.workspaceId);
        const nowIso = new Date().toISOString();
        const status = normalizeStatus(input.status);
        const metadata: InstagramCredentialMetadata = {
            channelId: input.channelId,
            pageId: input.pageId,
            pageName: input.pageName,
            instagramAccountId: input.instagramAccountId,
            instagramUsername: input.instagramUsername,
            appScopedUserId: input.appScopedUserId,
            scopes: normalizeScopes(input.scopes),
            tokenType: input.tokenType,
            expiresAt: input.expiresAt,
            connectedAt: nowIso,
            updatedAt: nowIso,
            lastRefreshedAt: nowIso,
            status,
            lastError: input.lastError,
        };

        const credentialName = credentialNameForChannel(input.channelId);

        await workspaceCredentialRepo.upsertCredential({
            workspaceId,
            provider: INSTAGRAM_CREDENTIAL_PROVIDER,
            name: credentialName,
            secret: input.accessToken,
            metadata: buildMetadataPayload(metadata),
            createdByUserId: input.createdByUserId,
        });

        const config = await instagramChannelRepo.upsertConfig({
            workspaceId,
            channelId: input.channelId,
            appScopedUserId: input.appScopedUserId,
            pageId: input.pageId,
            pageName: input.pageName,
            instagramAccountId: input.instagramAccountId,
            instagramUsername: input.instagramUsername,
            credentialName,
            tokenStatus: toTokenStatus(status),
            tokenExpiresAt: toDate(input.expiresAt),
            tokenLastRefreshAt: toDate(nowIso),
            metadata: {
                scopes: metadata.scopes,
                tokenType: metadata.tokenType,
                connectedAt: metadata.connectedAt,
                updatedAt: metadata.updatedAt,
                lastRefreshedAt: metadata.lastRefreshedAt,
                lastError: metadata.lastError,
            },
        });

        return toBinding(workspaceId, config, metadata);
    },

    async updateChannelCredentialMetadata(input: {
        workspaceId: string;
        channelId: string;
        accessToken?: string;
        patch: Partial<InstagramCredentialMetadata>;
        createdByUserId?: string;
    }): Promise<InstagramChannelBinding | null> {
        const workspaceId = assertTenantScope(input.workspaceId);
        const current = await this.getChannelCredential(workspaceId, input.channelId);
        if (!current) {
            return null;
        }

        const nowIso = new Date().toISOString();
        const patch = input.patch as Partial<InstagramCredentialMetadata> & Record<string, unknown>;

        const scopes = hasOwnField(patch, "scopes")
            ? normalizeScopes(input.patch.scopes)
            : normalizeScopes(current.metadata.scopes);

        const metadata: InstagramCredentialMetadata = {
            ...current.metadata,
            ...input.patch,
            channelId: current.metadata.channelId,
            pageId: input.patch.pageId || current.metadata.pageId,
            instagramAccountId: input.patch.instagramAccountId || current.metadata.instagramAccountId,
            scopes,
            status: hasOwnField(patch, "status")
                ? normalizeStatus(input.patch.status)
                : current.metadata.status,
            connectedAt: current.metadata.connectedAt,
            updatedAt: nowIso,
            lastRefreshedAt: hasOwnField(patch, "lastRefreshedAt")
                ? input.patch.lastRefreshedAt
                : current.metadata.lastRefreshedAt || nowIso,
            lastError: hasOwnField(patch, "lastError")
                ? input.patch.lastError
                : current.metadata.lastError,
        };

        const credentialName = credentialNameForChannel(input.channelId);

        await workspaceCredentialRepo.upsertCredential({
            workspaceId,
            provider: INSTAGRAM_CREDENTIAL_PROVIDER,
            name: credentialName,
            secret: input.accessToken || current.accessToken,
            metadata: buildMetadataPayload(metadata),
            createdByUserId: input.createdByUserId,
        });

        const config = await instagramChannelRepo.upsertConfig({
            workspaceId,
            channelId: input.channelId,
            appScopedUserId: metadata.appScopedUserId,
            pageId: metadata.pageId,
            pageName: metadata.pageName,
            instagramAccountId: metadata.instagramAccountId,
            instagramUsername: metadata.instagramUsername,
            credentialName,
            tokenStatus: toTokenStatus(metadata.status),
            tokenExpiresAt: toDate(metadata.expiresAt),
            tokenLastRefreshAt: toDate(metadata.lastRefreshedAt || nowIso),
            metadata: {
                scopes: metadata.scopes,
                tokenType: metadata.tokenType,
                connectedAt: metadata.connectedAt,
                updatedAt: metadata.updatedAt,
                lastRefreshedAt: metadata.lastRefreshedAt,
                lastError: metadata.lastError,
            },
        });

        return toBinding(workspaceId, config, metadata);
    },

    async getChannelCredential(workspaceIdInput: string, channelIdInput: string): Promise<{
        accessToken: string;
        metadata: InstagramCredentialMetadata;
    } | null> {
        const workspaceId = assertTenantScope(workspaceIdInput);
        const channelId = channelIdInput.trim();
        if (!channelId) {
            return null;
        }

        const config = await ensureChannelConfig(workspaceId, channelId);
        if (!config) {
            return null;
        }

        const defaultCredentialName = credentialNameForChannel(channelId);
        const candidateNames = Array.from(new Set([
            config.credentialName,
            defaultCredentialName,
        ].filter(Boolean)));

        const credentialRows = await prisma.workspaceCredential.findMany({
            where: {
                workspaceId,
                provider: INSTAGRAM_CREDENTIAL_PROVIDER,
                name: {
                    in: candidateNames,
                },
            },
            select: {
                name: true,
                metadata: true,
                updatedAt: true,
            },
            orderBy: {
                updatedAt: "desc",
            },
        });

        const rowByName = new Map(credentialRows.map((row) => [row.name, row]));
        const selectedRow = rowByName.get(config.credentialName) || rowByName.get(defaultCredentialName) || credentialRows[0];
        const selectedName = selectedRow?.name || config.credentialName || defaultCredentialName;
        const accessToken = await workspaceCredentialRepo.getCredentialSecret(workspaceId, selectedName);

        if (!accessToken) {
            return null;
        }

        const parsedMetadata = selectedRow ? readMetadata(selectedRow.metadata) : null;
        const metadata = mergeConfigAndMetadata(config, parsedMetadata);

        return {
            accessToken,
            metadata,
        };
    },

    async getChannelBinding(workspaceIdInput: string, channelId: string): Promise<InstagramChannelBinding | null> {
        const workspaceId = assertTenantScope(workspaceIdInput);
        const config = await ensureChannelConfig(workspaceId, channelId);
        if (!config) {
            return null;
        }

        const row = await prisma.workspaceCredential.findFirst({
            where: {
                workspaceId,
                provider: INSTAGRAM_CREDENTIAL_PROVIDER,
                name: config.credentialName,
            },
            select: {
                metadata: true,
            },
        });

        return toBinding(workspaceId, config, readMetadata(row?.metadata));
    },

    async listWorkspaceBindings(workspaceIdInput: string): Promise<InstagramChannelBinding[]> {
        const workspaceId = assertTenantScope(workspaceIdInput);
        await backfillWorkspaceConfigsFromLegacy(workspaceId);

        const configs = await instagramChannelRepo.listWorkspaceChannelConfigs(workspaceId);
        if (configs.length === 0) {
            return [];
        }

        const credentialNames = Array.from(new Set(configs.map((item) => item.credentialName).filter(Boolean)));
        const credentialRows = await prisma.workspaceCredential.findMany({
            where: {
                workspaceId,
                provider: INSTAGRAM_CREDENTIAL_PROVIDER,
                name: {
                    in: credentialNames,
                },
            },
            select: {
                name: true,
                metadata: true,
            },
        });

        const metadataByCredentialName = new Map<string, InstagramCredentialMetadata | null>();
        for (const row of credentialRows) {
            metadataByCredentialName.set(row.name, readMetadata(row.metadata));
        }

        return configs.map((config) => toBinding(
            workspaceId,
            config,
            metadataByCredentialName.get(config.credentialName)
        ));
    },

    async listExpiringCredentials(thresholdDate: Date): Promise<Array<{
        workspaceId: string;
        channelId: string;
        expiresAt: string;
    }>> {
        const configs = await prisma.instagramChannelConfig.findMany({
            where: {
                tokenExpiresAt: {
                    lte: thresholdDate,
                },
            },
            select: {
                workspaceId: true,
                channelId: true,
                tokenExpiresAt: true,
            },
        });

        const result = new Map<string, {
            workspaceId: string;
            channelId: string;
            expiresAt: string;
        }>();

        for (const row of configs) {
            if (!row.tokenExpiresAt) {
                continue;
            }

            const key = `${row.workspaceId}:${row.channelId}`;
            result.set(key, {
                workspaceId: row.workspaceId,
                channelId: row.channelId,
                expiresAt: row.tokenExpiresAt.toISOString(),
            });
        }

        const legacyRows = await prisma.workspaceCredential.findMany({
            where: {
                provider: INSTAGRAM_CREDENTIAL_PROVIDER,
                name: {
                    startsWith: "instagram:channel:",
                },
            },
            select: {
                workspaceId: true,
                metadata: true,
            },
        });

        const thresholdMs = thresholdDate.getTime();

        for (const row of legacyRows) {
            const metadata = readMetadata(row.metadata);
            if (!metadata?.expiresAt) {
                continue;
            }

            const expiresAt = new Date(metadata.expiresAt).getTime();
            if (!Number.isFinite(expiresAt) || expiresAt > thresholdMs) {
                continue;
            }

            const key = `${row.workspaceId}:${metadata.channelId}`;
            if (!result.has(key)) {
                await backfillChannelConfigFromLegacy(row.workspaceId, metadata.channelId);
                result.set(key, {
                    workspaceId: row.workspaceId,
                    channelId: metadata.channelId,
                    expiresAt: metadata.expiresAt,
                });
            }
        }

        return Array.from(result.values());
    },

    async clearChannelConnection(workspaceIdInput: string, channelIdInput: string): Promise<void> {
        const workspaceId = assertTenantScope(workspaceIdInput);
        const channelId = channelIdInput.trim();

        const config = await ensureChannelConfig(workspaceId, channelId);
        const credentialNames = Array.from(new Set([
            credentialNameForChannel(channelId),
            config?.credentialName,
        ].filter((item): item is string => Boolean(item))));

        await Promise.all([
            instagramChannelRepo.deleteWorkspaceChannelConfig(workspaceId, channelId),
            prisma.workspaceCredential.deleteMany({
                where: {
                    workspaceId,
                    provider: INSTAGRAM_CREDENTIAL_PROVIDER,
                    name: {
                        in: credentialNames,
                    },
                },
            }),
        ]);
    },

    async touchInvalidState(input: {
        workspaceId: string;
        channelId: string;
        reason: string;
    }) {
        const current = await this.getChannelCredential(input.workspaceId, input.channelId);
        if (!current) {
            return null;
        }

        return this.updateChannelCredentialMetadata({
            workspaceId: input.workspaceId,
            channelId: input.channelId,
            patch: {
                status: "invalid",
                lastError: input.reason,
            },
        });
    },
};
