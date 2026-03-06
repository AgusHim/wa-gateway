export type DashboardDateRangeSearchParams = {
    q?: string;
    label?: string;
    dateFrom?: string;
    dateTo?: string;
};

export type UsersSearchParams = DashboardDateRangeSearchParams;

export type ConversationsSearchParams = DashboardDateRangeSearchParams & {
    userId?: string;
    channelId?: string;
};

export type ToolLogsSearchParams = {
    toolName?: string;
    status?: "success" | "failed";
};

export type PageWithSearchParams<TSearchParams> = {
    searchParams: Promise<TSearchParams>;
};

export type PageWithParams<TParams> = {
    params: Promise<TParams>;
};

export type WAConnectionStatus = "open" | "close" | "connecting";
export type WAHealthStatus = "connected" | "degraded" | "disconnected" | "banned-risk";

export type WaChannelRuntimeStatus = {
    channelId: string;
    name: string;
    provider: string;
    identifier?: string | null;
    status: WAConnectionStatus;
    isEnabled: boolean;
    isPrimary: boolean;
    healthStatus: string;
    healthScore: number;
    rateLimitPerSecond: number;
    qrExpiresAt?: number | null;
    hasQr?: boolean;
    lastSeenAt?: string | Date | null;
    lastError?: string | null;
};

export type WaStatusResponse = {
    status: WAConnectionStatus;
    selectedChannelId?: string | null;
    primaryChannelId?: string | null;
    channels?: WaChannelRuntimeStatus[];
};

export type ConnectionUpdatePayload = {
    status: WAConnectionStatus;
    workspaceId?: string;
    channelId?: string;
    healthStatus?: WAHealthStatus;
    message?: string;
};

export type QrPayload = {
    workspaceId?: string;
    channelId?: string;
    qr: string;
    expiresAt?: number;
};

export type MonitorMessagePayload = {
    workspaceId?: string;
    channelId?: string;
    phoneNumber: string;
    messageText: string;
    messageId: string;
    pushName?: string;
    timestamp: number;
};

export type AnalyticsMessageVolume = {
    date: string;
    count: number;
};

export type AnalyticsToolUsage = {
    toolName: string;
    count: number;
};

export type AnalyticsTokenUsage = {
    model: string;
    totalTokens: number;
    estimatedCostUsd: number;
};

export type AnalyticsSummary = {
    messageVolume: AnalyticsMessageVolume[];
    topTools: AnalyticsToolUsage[];
    tokenUsage: AnalyticsTokenUsage[];
};

export const EMPTY_ANALYTICS_SUMMARY: AnalyticsSummary = {
    messageVolume: [],
    topTools: [],
    tokenUsage: [],
};

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isConnectionStatus(value: unknown): value is WAConnectionStatus {
    return value === "open" || value === "close" || value === "connecting";
}

function isHealthStatus(value: unknown): value is WAHealthStatus {
    return value === "connected"
        || value === "degraded"
        || value === "disconnected"
        || value === "banned-risk";
}

function readOptionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseWaStatusResponse(value: unknown): WaStatusResponse | null {
    if (!isObject(value) || !isConnectionStatus(value.status)) {
        return null;
    }

    let channels: WaChannelRuntimeStatus[] | undefined;
    if (Array.isArray(value.channels)) {
        channels = value.channels
            .filter((item): item is Record<string, unknown> => isObject(item))
            .map((item) => {
                const status = isConnectionStatus(item.status) ? item.status : "close";
                return {
                    channelId: String(item.channelId || ""),
                    name: String(item.name || ""),
                    provider: String(item.provider || "whatsapp"),
                    identifier: typeof item.identifier === "string" ? item.identifier : null,
                    status,
                    isEnabled: item.isEnabled === true,
                    isPrimary: item.isPrimary === true,
                    healthStatus: String(item.healthStatus || "DISCONNECTED"),
                    healthScore: readNumber(item.healthScore) ?? 0,
                    rateLimitPerSecond: readNumber(item.rateLimitPerSecond) ?? 5,
                    qrExpiresAt: readNumber(item.qrExpiresAt),
                    hasQr: item.hasQr === true,
                    lastSeenAt: typeof item.lastSeenAt === "string" ? item.lastSeenAt : null,
                    lastError: typeof item.lastError === "string" ? item.lastError : null,
                };
            })
            .filter((item) => item.channelId.length > 0);
    }

    return {
        status: value.status,
        selectedChannelId: readOptionalString(value.selectedChannelId) ?? null,
        primaryChannelId: readOptionalString(value.primaryChannelId) ?? null,
        channels,
    };
}

export function parseConnectionUpdatePayload(value: unknown): ConnectionUpdatePayload | null {
    if (!isObject(value) || !isConnectionStatus(value.status)) {
        return null;
    }

    return {
        status: value.status,
        workspaceId: readOptionalString(value.workspaceId),
        channelId: readOptionalString(value.channelId),
        healthStatus: isHealthStatus(value.healthStatus) ? value.healthStatus : undefined,
        message: readOptionalString(value.message),
    };
}

export function parseQrPayload(value: unknown): QrPayload | null {
    if (!isObject(value) || typeof value.qr !== "string") {
        return null;
    }

    return {
        workspaceId: readOptionalString(value.workspaceId),
        channelId: readOptionalString(value.channelId),
        qr: value.qr,
        expiresAt: readNumber(value.expiresAt) ?? undefined,
    };
}

export function parseMonitorMessagePayload(value: unknown): MonitorMessagePayload | null {
    if (!isObject(value)) {
        return null;
    }

    const timestamp = readNumber(value.timestamp);
    if (
        typeof value.phoneNumber !== "string"
        || typeof value.messageText !== "string"
        || typeof value.messageId !== "string"
        || timestamp === null
    ) {
        return null;
    }

    return {
        workspaceId: readOptionalString(value.workspaceId),
        channelId: readOptionalString(value.channelId),
        phoneNumber: value.phoneNumber,
        messageText: value.messageText,
        messageId: value.messageId,
        pushName: readOptionalString(value.pushName),
        timestamp,
    };
}

function parseMessageVolumeItem(value: unknown): AnalyticsMessageVolume | null {
    if (!isObject(value)) return null;
    const count = readNumber(value.count);
    if (typeof value.date !== "string" || count === null) {
        return null;
    }
    return { date: value.date, count };
}

function parseToolUsageItem(value: unknown): AnalyticsToolUsage | null {
    if (!isObject(value)) return null;
    const count = readNumber(value.count);
    if (typeof value.toolName !== "string" || count === null) {
        return null;
    }
    return { toolName: value.toolName, count };
}

function parseTokenUsageItem(value: unknown): AnalyticsTokenUsage | null {
    if (!isObject(value)) return null;
    const totalTokens = readNumber(value.totalTokens);
    const estimatedCostUsd = readNumber(value.estimatedCostUsd);
    if (
        typeof value.model !== "string"
        || totalTokens === null
        || estimatedCostUsd === null
    ) {
        return null;
    }

    return {
        model: value.model,
        totalTokens,
        estimatedCostUsd,
    };
}

export function parseAnalyticsSummary(value: unknown): AnalyticsSummary | null {
    if (!isObject(value)) return null;
    if (
        !Array.isArray(value.messageVolume)
        || !Array.isArray(value.topTools)
        || !Array.isArray(value.tokenUsage)
    ) {
        return null;
    }

    const messageVolume = value.messageVolume
        .map(parseMessageVolumeItem)
        .filter((item): item is AnalyticsMessageVolume => item !== null);
    const topTools = value.topTools
        .map(parseToolUsageItem)
        .filter((item): item is AnalyticsToolUsage => item !== null);
    const tokenUsage = value.tokenUsage
        .map(parseTokenUsageItem)
        .filter((item): item is AnalyticsTokenUsage => item !== null);

    return {
        messageVolume,
        topTools,
        tokenUsage,
    };
}
