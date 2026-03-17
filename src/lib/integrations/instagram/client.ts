import crypto from "crypto";
import { CircuitBreakerOpenError, executeWithCircuitBreaker } from "@/lib/resilience/circuitBreaker";
import { logInfo, logWarn } from "@/lib/observability/logger";
import { getInstagramIntegrationConfig } from "./config";
import { instagramRepo } from "./repo";

export type InstagramOutboundTarget = "dm" | "comment";

export type InstagramOutboundErrorClassification =
    | "network_error"
    | "rate_limit"
    | "server_error"
    | "auth_error"
    | "permission_error"
    | "invalid_request"
    | "policy_error"
    | "circuit_open"
    | "unknown";

export class InstagramOutboundError extends Error {
    readonly retryable: boolean;
    readonly classification: InstagramOutboundErrorClassification;
    readonly reasonCode: string;
    readonly status?: number;
    readonly code?: number;
    readonly type?: string;
    readonly traceId?: string;

    constructor(input: {
        message: string;
        classification: InstagramOutboundErrorClassification;
        reasonCode: string;
        retryable: boolean;
        status?: number;
        code?: number;
        type?: string;
        traceId?: string;
    }) {
        super(input.message);
        this.name = "InstagramOutboundError";
        this.retryable = input.retryable;
        this.classification = input.classification;
        this.reasonCode = input.reasonCode;
        this.status = input.status;
        this.code = input.code;
        this.type = input.type;
        this.traceId = input.traceId;
    }
}

export type InstagramOutboundSuccessResult = {
    ok: true;
    target: InstagramOutboundTarget;
    externalId: string;
    statusCode: number;
    raw: Record<string, unknown>;
};

export type InstagramOutboundFailureResult = {
    ok: false;
    target: InstagramOutboundTarget;
    error: InstagramOutboundError;
};

export type InstagramOutboundResult = InstagramOutboundSuccessResult | InstagramOutboundFailureResult;

type GraphJsonResponse = {
    status: number;
    payload: Record<string, unknown>;
};

type GraphErrorPayload = {
    status?: number;
    message: string;
    code?: number;
    type?: string;
    traceId?: string;
};

function parseBooleanEnv(name: string, fallback: boolean): boolean {
    const raw = String(process.env[name] || "").trim().toLowerCase();
    if (!raw) {
        return fallback;
    }

    return !["0", "false", "off", "no"].includes(raw);
}

function parseIntegerEnv(name: string, fallback: number, min: number, max: number): number {
    const parsed = Number(process.env[name]);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function getGraphBaseUrl(): string {
    const version = getInstagramIntegrationConfig()?.graphApiVersion || "v23.0";
    return `https://graph.facebook.com/${version}`;
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function normalizeErrorCode(value: string): string {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return normalized || "unknown";
}

function buildAppSecretProof(accessToken: string): string | undefined {
    if (!parseBooleanEnv("INSTAGRAM_APPSECRET_PROOF_ENABLED", false)) {
        return undefined;
    }

    const appSecret = getInstagramIntegrationConfig()?.appSecret;
    if (!appSecret) {
        return undefined;
    }

    return crypto
        .createHmac("sha256", appSecret)
        .update(accessToken)
        .digest("hex");
}

function buildCircuitOptions() {
    return {
        failureThreshold: parseIntegerEnv("INSTAGRAM_OUTBOUND_CIRCUIT_FAILURE_THRESHOLD", 4, 1, 50),
        resetTimeoutMs: parseIntegerEnv("INSTAGRAM_OUTBOUND_CIRCUIT_RESET_MS", 30_000, 1000, 300_000),
        successThreshold: parseIntegerEnv("INSTAGRAM_OUTBOUND_CIRCUIT_SUCCESS_THRESHOLD", 1, 1, 10),
    };
}

function buildRetryConfig() {
    return {
        maxRetries: parseIntegerEnv("INSTAGRAM_OUTBOUND_MAX_RETRIES", 2, 0, 10),
        baseDelayMs: parseIntegerEnv("INSTAGRAM_OUTBOUND_RETRY_BASE_MS", 600, 100, 10_000),
        jitterMs: parseIntegerEnv("INSTAGRAM_OUTBOUND_RETRY_JITTER_MS", 200, 0, 10_000),
        timeoutMs: parseIntegerEnv("INSTAGRAM_OUTBOUND_REQUEST_TIMEOUT_MS", 12_000, 1000, 60_000),
    };
}

function classifyGraphError(input: GraphErrorPayload): InstagramOutboundError {
    const message = input.message || "Instagram Graph API request failed";
    const status = input.status;
    const code = input.code;

    if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613) {
        return new InstagramOutboundError({
            message,
            classification: "rate_limit",
            reasonCode: normalizeErrorCode(`meta_rate_limit_${status || code || "unknown"}`),
            retryable: true,
            status,
            code,
            type: input.type,
            traceId: input.traceId,
        });
    }

    if (status !== undefined && status >= 500) {
        return new InstagramOutboundError({
            message,
            classification: "server_error",
            reasonCode: normalizeErrorCode(`meta_server_${status}`),
            retryable: true,
            status,
            code,
            type: input.type,
            traceId: input.traceId,
        });
    }

    if (code === 10 || code === 200 || code === 299) {
        return new InstagramOutboundError({
            message,
            classification: "permission_error",
            reasonCode: normalizeErrorCode(`meta_permission_${code}`),
            retryable: false,
            status,
            code,
            type: input.type,
            traceId: input.traceId,
        });
    }

    if (status === 401 || status === 403 || code === 190) {
        return new InstagramOutboundError({
            message,
            classification: "auth_error",
            reasonCode: normalizeErrorCode(`meta_auth_${status || code || "unknown"}`),
            retryable: false,
            status,
            code,
            type: input.type,
            traceId: input.traceId,
        });
    }

    if (status === 400 || status === 404) {
        return new InstagramOutboundError({
            message,
            classification: "invalid_request",
            reasonCode: normalizeErrorCode(`meta_invalid_${status}`),
            retryable: false,
            status,
            code,
            type: input.type,
            traceId: input.traceId,
        });
    }

    return new InstagramOutboundError({
        message,
        classification: "unknown",
        reasonCode: normalizeErrorCode(`meta_unknown_${status || code || "error"}`),
        retryable: status !== undefined ? status >= 500 : true,
        status,
        code,
        type: input.type,
        traceId: input.traceId,
    });
}

function toOutboundError(error: unknown): InstagramOutboundError {
    if (error instanceof InstagramOutboundError) {
        return error;
    }

    if (error instanceof CircuitBreakerOpenError) {
        return new InstagramOutboundError({
            message: error.message,
            classification: "circuit_open",
            reasonCode: "circuit_open",
            retryable: true,
        });
    }

    if (error instanceof Error) {
        return new InstagramOutboundError({
            message: error.message,
            classification: "network_error",
            reasonCode: "network_error",
            retryable: true,
        });
    }

    return new InstagramOutboundError({
        message: "instagram_outbound_failed",
        classification: "unknown",
        reasonCode: "unknown_error",
        retryable: true,
    });
}

async function postGraphForm(input: {
    path: string;
    accessToken: string;
    fields: Record<string, string>;
    timeoutMs: number;
}): Promise<GraphJsonResponse> {
    const url = new URL(`${getGraphBaseUrl()}${input.path}`);
    const form = new URLSearchParams();

    form.set("access_token", input.accessToken);
    for (const [key, value] of Object.entries(input.fields)) {
        if (!value) continue;
        form.set(key, value);
    }

    const appSecretProof = buildAppSecretProof(input.accessToken);
    if (appSecretProof) {
        form.set("appsecret_proof", appSecretProof);
    }

    logInfo("instagram.graph.request", {
        path: input.path,
        timeoutMs: input.timeoutMs,
    });

    const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        cache: "no-store",
        signal: AbortSignal.timeout(input.timeoutMs),
    });

    let payload: Record<string, unknown> = {};
    try {
        payload = asRecord(await response.json());
    } catch {
        payload = {};
    }

    if (!response.ok || payload.error) {
        const errPayload = asRecord(payload.error || payload);
        logWarn("instagram.graph.request_failed", {
            path: input.path,
            status: response.status,
            code: readNumber(errPayload.code),
            type: readString(errPayload.type),
            traceId: readString(errPayload.fbtrace_id),
        });
        throw classifyGraphError({
            status: response.status,
            message: readString(errPayload.message) || `Meta Graph API request failed (${response.status})`,
            code: readNumber(errPayload.code),
            type: readString(errPayload.type),
            traceId: readString(errPayload.fbtrace_id),
        });
    }

    logInfo("instagram.graph.request_succeeded", {
        path: input.path,
        status: response.status,
    });

    return {
        status: response.status,
        payload,
    };
}

async function executeGraphOperationWithResilience(input: {
    workspaceId: string;
    channelId: string;
    target: InstagramOutboundTarget;
    operation: () => Promise<GraphJsonResponse>;
}): Promise<GraphJsonResponse> {
    const retry = buildRetryConfig();
    const circuitKey = `instagram-outbound:${input.workspaceId}:${input.channelId}:${input.target}`;

    return executeWithCircuitBreaker(circuitKey, async () => {
        let attempt = 0;
        while (true) {
            try {
                return await input.operation();
            } catch (error) {
                const outboundError = toOutboundError(error);
                if (!outboundError.retryable || attempt >= retry.maxRetries) {
                    throw outboundError;
                }

                const backoff = (retry.baseDelayMs * Math.pow(2, attempt))
                    + (retry.jitterMs ? Math.floor(Math.random() * retry.jitterMs) : 0);
                attempt += 1;
                logWarn("instagram.graph.retry_scheduled", {
                    target: input.target,
                    attempt,
                    maxRetries: retry.maxRetries,
                    reasonCode: outboundError.reasonCode,
                    classification: outboundError.classification,
                    backoffMs: backoff,
                });
                await wait(backoff);
            }
        }
    }, buildCircuitOptions());
}

function missingCredentialResult(target: InstagramOutboundTarget): InstagramOutboundResult {
    return {
        ok: false,
        target,
        error: new InstagramOutboundError({
            message: "Instagram credential not found. Connect channel first.",
            classification: "auth_error",
            reasonCode: "credential_missing",
            retryable: false,
        }),
    };
}

function extractExternalId(target: InstagramOutboundTarget, payload: Record<string, unknown>): string | undefined {
    const candidates = target === "dm"
        ? [payload.message_id, payload.id]
        : [payload.id, payload.message_id];

    for (const candidate of candidates) {
        const value = readString(candidate);
        if (value) {
            return value;
        }
    }

    return undefined;
}

export async function sendInstagramDirectMessage(input: {
    workspaceId: string;
    channelId: string;
    recipientIgUserId: string;
    text: string;
}): Promise<InstagramOutboundResult> {
    const recipientIgUserId = input.recipientIgUserId.trim();
    const text = input.text.trim();

    if (!recipientIgUserId) {
        return {
            ok: false,
            target: "dm",
            error: new InstagramOutboundError({
                message: "Recipient IG user id is required",
                classification: "invalid_request",
                reasonCode: "recipient_missing",
                retryable: false,
            }),
        };
    }

    if (!text) {
        return {
            ok: false,
            target: "dm",
            error: new InstagramOutboundError({
                message: "Message text is empty",
                classification: "policy_error",
                reasonCode: "empty_message",
                retryable: false,
            }),
        };
    }

    const credential = await instagramRepo.getChannelCredential(input.workspaceId, input.channelId);
    if (!credential) {
        return missingCredentialResult("dm");
    }

    const instagramAccountId = credential.metadata.instagramAccountId?.trim();
    if (!instagramAccountId) {
        return {
            ok: false,
            target: "dm",
            error: new InstagramOutboundError({
                message: "Instagram account binding is missing",
                classification: "invalid_request",
                reasonCode: "instagram_account_missing",
                retryable: false,
            }),
        };
    }

    try {
        const response = await executeGraphOperationWithResilience({
            workspaceId: input.workspaceId,
            channelId: input.channelId,
            target: "dm",
            operation: () => postGraphForm({
                path: `/${instagramAccountId}/messages`,
                accessToken: credential.accessToken,
                fields: {
                    recipient: JSON.stringify({ id: recipientIgUserId }),
                    message: JSON.stringify({ text }),
                    messaging_type: "RESPONSE",
                },
                timeoutMs: buildRetryConfig().timeoutMs,
            }),
        });

        const externalId = extractExternalId("dm", response.payload);
        if (!externalId) {
            return {
                ok: false,
                target: "dm",
                error: new InstagramOutboundError({
                    message: "Meta response missing message id",
                    classification: "unknown",
                    reasonCode: "external_id_missing",
                    retryable: false,
                    status: response.status,
                }),
            };
        }

        return {
            ok: true,
            target: "dm",
            externalId,
            statusCode: response.status,
            raw: response.payload,
        };
    } catch (error) {
        return {
            ok: false,
            target: "dm",
            error: toOutboundError(error),
        };
    }
}

export async function replyInstagramComment(input: {
    workspaceId: string;
    channelId: string;
    commentId: string;
    text: string;
}): Promise<InstagramOutboundResult> {
    const commentId = input.commentId.trim();
    const text = input.text.trim();

    if (!commentId) {
        return {
            ok: false,
            target: "comment",
            error: new InstagramOutboundError({
                message: "Comment id is required",
                classification: "invalid_request",
                reasonCode: "comment_id_missing",
                retryable: false,
            }),
        };
    }

    if (!text) {
        return {
            ok: false,
            target: "comment",
            error: new InstagramOutboundError({
                message: "Reply text is empty",
                classification: "policy_error",
                reasonCode: "empty_message",
                retryable: false,
            }),
        };
    }

    const credential = await instagramRepo.getChannelCredential(input.workspaceId, input.channelId);
    if (!credential) {
        return missingCredentialResult("comment");
    }

    try {
        const response = await executeGraphOperationWithResilience({
            workspaceId: input.workspaceId,
            channelId: input.channelId,
            target: "comment",
            operation: () => postGraphForm({
                path: `/${commentId}/replies`,
                accessToken: credential.accessToken,
                fields: {
                    message: text,
                },
                timeoutMs: buildRetryConfig().timeoutMs,
            }),
        });

        const externalId = extractExternalId("comment", response.payload);
        if (!externalId) {
            return {
                ok: false,
                target: "comment",
                error: new InstagramOutboundError({
                    message: "Meta response missing reply id",
                    classification: "unknown",
                    reasonCode: "external_id_missing",
                    retryable: false,
                    status: response.status,
                }),
            };
        }

        return {
            ok: true,
            target: "comment",
            externalId,
            statusCode: response.status,
            raw: response.payload,
        };
    } catch (error) {
        return {
            ok: false,
            target: "comment",
            error: toOutboundError(error),
        };
    }
}
