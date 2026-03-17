import crypto from "crypto";
import { Job, Worker } from "bullmq";
import { ChannelProvider, UsageMetric } from "@prisma/client";
import { runAgent } from "@/agent/runner";
import { sendOperatorReport } from "@/lib/baileys/client";
import { billingService } from "@/lib/billing/service";
import { prisma } from "@/lib/db/client";
import { channelRepo } from "@/lib/db/channelRepo";
import { configRepo } from "@/lib/db/configRepo";
import { handoverRepo } from "@/lib/handover/repo";
import { messageRepo } from "@/lib/db/messageRepo";
import { userRepo } from "@/lib/db/userRepo";
import { webhookService } from "@/lib/integrations/webhookService";
import {
    recordDeliveryFailureReason,
    recordDeliveryResult,
    recordQueueLag,
    recordWorkerThroughput,
} from "@/lib/observability/metrics";
import { withObservationContext } from "@/lib/observability/context";
import { logError, logInfo, logWarn } from "@/lib/observability/logger";
import { resolveWorkerConcurrencyConfig, startQueueAutoscaler } from "@/lib/queue/autoscaler";
import { redis } from "@/lib/queue/client";
import { consumeInstagramInboundDebouncedBatch } from "./inboundDebounce";
import {
    InstagramOutboundError,
    InstagramOutboundResult,
    replyInstagramComment,
    sendInstagramDirectMessage,
} from "./client";
import { evaluateInstagramOutboundPolicy, consumeInstagramOutboundRateLimit } from "./compliance";
import { resolveInstagramLaunchMode } from "./launchMode";
import { buildInstagramMessageMetadata } from "./messageMetadata";
import { evaluateInstagramAutoReplyRule, getWorkspaceInstagramAutoReplyRules } from "./ruleConfig";
import {
    InstagramWebhookDeadLetterJob,
    InstagramWebhookQueueJob,
    getInstagramWebhookDeadLetterQueue,
    getInstagramWebhookQueueName,
} from "./webhookQueue";

const workersByQueue = new Map<string, Worker<InstagramWebhookQueueJob>>();

type InstagramWebhookWorkerDeps = {
    consumeInstagramInboundDebouncedBatch: typeof consumeInstagramInboundDebouncedBatch;
    recordQueueLag: typeof recordQueueLag;
    logInfo: typeof logInfo;
    prisma: typeof prisma;
    billingService: typeof billingService;
    messageRepo: typeof messageRepo;
    channelRepo: typeof channelRepo;
    handoverRepo: typeof handoverRepo;
    runAgent: typeof runAgent;
    consumeInstagramOutboundRateLimit: typeof consumeInstagramOutboundRateLimit;
    replyInstagramComment: typeof replyInstagramComment;
    sendInstagramDirectMessage: typeof sendInstagramDirectMessage;
    recordDeliveryResult: typeof recordDeliveryResult;
    recordDeliveryFailureReason: typeof recordDeliveryFailureReason;
    webhookService: typeof webhookService;
    sendOperatorReport: typeof sendOperatorReport;
    userRepo: typeof userRepo;
    logWarn: typeof logWarn;
    createAudit: typeof channelRepo.createAudit;
    attachInstagramOutboundResultByEventId: typeof messageRepo.attachInstagramOutboundResultByEventId;
    saveMessage: typeof messageRepo.saveMessage;
    getInstagramThreadAutoReplyState: typeof messageRepo.getInstagramThreadAutoReplyState;
    hasHumanOperatorReplyInInstagramThreadSince: typeof messageRepo.hasHumanOperatorReplyInInstagramThreadSince;
    markPending: typeof handoverRepo.markPending;
    getWorkspaceInstagramAutoReplyRules: typeof getWorkspaceInstagramAutoReplyRules;
    getBotConfig: typeof configRepo.getBotConfig;
    evaluateInstagramAutoReplyRule: typeof evaluateInstagramAutoReplyRule;
};

function defaultInstagramWebhookWorkerDeps(): InstagramWebhookWorkerDeps {
    return {
        consumeInstagramInboundDebouncedBatch,
        recordQueueLag,
        logInfo,
        prisma,
        billingService,
        messageRepo,
        channelRepo,
        handoverRepo,
        runAgent,
        consumeInstagramOutboundRateLimit,
        replyInstagramComment,
        sendInstagramDirectMessage,
        recordDeliveryResult,
        recordDeliveryFailureReason,
        webhookService,
        sendOperatorReport,
        userRepo,
        logWarn,
        createAudit: channelRepo.createAudit.bind(channelRepo),
        attachInstagramOutboundResultByEventId: messageRepo.attachInstagramOutboundResultByEventId.bind(messageRepo),
        saveMessage: messageRepo.saveMessage.bind(messageRepo),
        getInstagramThreadAutoReplyState: messageRepo.getInstagramThreadAutoReplyState.bind(messageRepo),
        hasHumanOperatorReplyInInstagramThreadSince: messageRepo.hasHumanOperatorReplyInInstagramThreadSince.bind(messageRepo),
        markPending: handoverRepo.markPending.bind(handoverRepo),
        getWorkspaceInstagramAutoReplyRules,
        getBotConfig: configRepo.getBotConfig.bind(configRepo),
        evaluateInstagramAutoReplyRule,
    };
}

function resolveConcurrency() {
    return resolveWorkerConcurrencyConfig({
        envPrefix: "INSTAGRAM_WEBHOOK_WORKER",
        defaultInitial: 2,
        defaultMaxCap: 32,
        defaultTargetBacklog: 15,
    });
}

function isFinalFailure(job: Job<InstagramWebhookQueueJob>): boolean {
    const attemptsConfigured = Number(job.opts.attempts ?? 1);
    const attempts = Number.isFinite(attemptsConfigured) ? Math.max(1, attemptsConfigured) : 1;
    return job.attemptsMade >= attempts;
}

function currentAttempt(job: Job<InstagramWebhookQueueJob>): number {
    return Math.max(1, job.attemptsMade + 1);
}

function safeQueueLagMs(value: number | undefined): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.max(0, value as number);
}

function buildEventPlaceholder(job: InstagramWebhookQueueJob): string {
    if (job.eventType === "instagram-comment") {
        return `[instagram-comment:${job.commentId || job.eventId}]`;
    }
    return `[instagram-dm:${job.messageId || job.eventId}]`;
}

function resolveInstagramUserIdentifier(job: InstagramWebhookQueueJob): string {
    const userId = job.igUserId?.trim().toLowerCase();
    if (userId) {
        return `ig:${userId}`;
    }

    const username = job.igUsername?.trim().toLowerCase();
    if (username) {
        return `ig:u:${username}`;
    }

    const hash = crypto.createHash("sha256").update(job.eventKey).digest("hex").slice(0, 16);
    return `ig:unknown:${hash}`;
}

function toInstagramOutboundError(error: unknown): InstagramOutboundError {
    if (error instanceof InstagramOutboundError) {
        return error;
    }

    if (error instanceof Error) {
        return new InstagramOutboundError({
            message: error.message,
            classification: "unknown",
            reasonCode: "worker_failed",
            retryable: false,
        });
    }

    return new InstagramOutboundError({
        message: "instagram_outbound_failed",
        classification: "unknown",
        reasonCode: "worker_failed",
        retryable: false,
    });
}

function buildMessageMetadata(job: InstagramWebhookQueueJob, batchCount: number): Record<string, unknown> {
    return {
        ...buildInstagramMessageMetadata({
            eventType: job.eventType,
            channelId: job.channelId,
            igUserId: job.igUserId,
            igUsername: job.igUsername,
            threadId: job.threadId,
            commentId: job.commentId,
            mediaId: job.mediaId,
            pageId: job.pageId,
            instagramAccountId: job.instagramAccountId,
        }),
        eventId: job.eventId,
        eventKey: job.eventKey,
        messageId: job.messageId,
        replayed: job.replayed === true,
        batchCount,
        sourceEventIds: job.sourceEventIds,
    };
}

async function enqueueDeadLetter(job: Job<InstagramWebhookQueueJob>, err: Error) {
    const deadLetter: InstagramWebhookDeadLetterJob = {
        sourceQueue: job.queueName,
        originalJobId: job.id ? String(job.id) : undefined,
        failedReason: err.message,
        attemptsMade: job.attemptsMade,
        failedAt: Date.now(),
        workspaceId: job.data.workspaceId,
        channelId: job.data.channelId,
        eventId: job.data.eventId,
        eventKey: job.data.eventKey,
        payload: job.data,
    };

    const dlq = getInstagramWebhookDeadLetterQueue(job.data.workspaceId, job.data.channelId);
    await dlq.add(`ig-dlq:${job.data.eventId}:${Date.now()}`, deadLetter);
}

function outboundTargetFromEvent(job: InstagramWebhookQueueJob): "dm" | "comment" {
    return job.eventType === "instagram-comment" ? "comment" : "dm";
}

function usageMetricForOutbound(eventType: InstagramWebhookQueueJob["eventType"]): UsageMetric {
    return eventType === "instagram-comment"
        ? UsageMetric.IG_COMMENT_REPLY
        : UsageMetric.IG_OUTBOUND;
}

async function persistOutboundSuccess(input: {
    payload: InstagramWebhookQueueJob;
    responseText: string;
    batchCount: number;
    outboundResult: InstagramOutboundResult & { ok: true };
    attempt: number;
}, deps: Pick<InstagramWebhookWorkerDeps, "recordDeliveryResult" | "attachInstagramOutboundResultByEventId" | "createAudit" | "webhookService">) {
    await deps.recordDeliveryResult({
        workspaceId: input.payload.workspaceId,
        channelId: input.payload.channelId,
        success: true,
        provider: "instagram",
    });

    await deps.attachInstagramOutboundResultByEventId({
        workspaceId: input.payload.workspaceId,
        channelId: input.payload.channelId,
        eventId: input.payload.eventId,
        outbound: {
            status: "sent",
            target: input.outboundResult.target,
            externalId: input.outboundResult.externalId,
            statusCode: input.outboundResult.statusCode,
            attempt: input.attempt,
            finalFailure: false,
        },
    });

    await deps.createAudit(input.payload.channelId, {
        eventType: "instagram_outbound_sent",
        status: "success",
        message: `${input.payload.eventType}:${input.payload.eventId}`,
        metadata: {
            eventId: input.payload.eventId,
            eventKey: input.payload.eventKey,
            threadId: input.payload.threadId,
            commentId: input.payload.commentId,
            batchCount: input.batchCount,
            outboundTarget: input.outboundResult.target,
            externalId: input.outboundResult.externalId,
            attempt: input.attempt,
        },
    });

    await deps.webhookService.enqueueEvent({
        workspaceId: input.payload.workspaceId,
        eventType: "MESSAGE_SENT",
        payload: {
            provider: "instagram",
            channelId: input.payload.channelId,
            status: "sent",
            outboundTarget: outboundTargetFromEvent(input.payload),
            eventType: input.payload.eventType,
            sourceEventId: input.payload.eventId,
            threadId: input.payload.threadId || null,
            commentId: input.payload.commentId || null,
            igUserId: input.payload.igUserId || null,
            externalId: input.outboundResult.externalId,
            reasonCode: null,
            failureMessage: null,
            retryable: null,
            finalFailure: null,
            responsePreview: input.responseText.slice(0, 300),
        },
    }).catch((error) => {
        logError("instagram.outbound.webhook_emit_failed", error, {
            workspaceId: input.payload.workspaceId,
            channelId: input.payload.channelId,
            eventId: input.payload.eventId,
        });
    });
}

async function persistOutboundFailure(input: {
    payload: InstagramWebhookQueueJob;
    responseText?: string;
    batchCount: number;
    error: InstagramOutboundError;
    attempt: number;
    finalFailure: boolean;
    notifyOperator: boolean;
}, deps: Pick<InstagramWebhookWorkerDeps, "recordDeliveryResult" | "recordDeliveryFailureReason" | "attachInstagramOutboundResultByEventId" | "createAudit" | "webhookService" | "sendOperatorReport">) {
    await deps.recordDeliveryResult({
        workspaceId: input.payload.workspaceId,
        channelId: input.payload.channelId,
        success: false,
        provider: "instagram",
    });

    await deps.recordDeliveryFailureReason({
        workspaceId: input.payload.workspaceId,
        channelId: input.payload.channelId,
        reason: input.error.reasonCode,
    });

    await deps.attachInstagramOutboundResultByEventId({
        workspaceId: input.payload.workspaceId,
        channelId: input.payload.channelId,
        eventId: input.payload.eventId,
        outbound: {
            status: "failed",
            target: outboundTargetFromEvent(input.payload),
            reasonCode: input.error.reasonCode,
            failureMessage: input.error.message,
            retryable: input.error.retryable,
            statusCode: input.error.status,
            metaCode: input.error.code,
            traceId: input.error.traceId,
            attempt: input.attempt,
            finalFailure: input.finalFailure,
        },
    });

    await deps.createAudit(input.payload.channelId, {
        eventType: "instagram_outbound_failed",
        status: input.finalFailure ? "error" : "retrying",
        message: `${input.payload.eventType}:${input.payload.eventId}`,
        metadata: {
            eventId: input.payload.eventId,
            eventKey: input.payload.eventKey,
            threadId: input.payload.threadId,
            commentId: input.payload.commentId,
            batchCount: input.batchCount,
            outboundTarget: outboundTargetFromEvent(input.payload),
            reasonCode: input.error.reasonCode,
            retryable: input.error.retryable,
            finalFailure: input.finalFailure,
            statusCode: input.error.status,
            metaCode: input.error.code,
            traceId: input.error.traceId,
            attempt: input.attempt,
        },
    });

    await deps.webhookService.enqueueEvent({
        workspaceId: input.payload.workspaceId,
        eventType: "MESSAGE_SENT",
        payload: {
            provider: "instagram",
            channelId: input.payload.channelId,
            status: "failed",
            outboundTarget: outboundTargetFromEvent(input.payload),
            eventType: input.payload.eventType,
            sourceEventId: input.payload.eventId,
            threadId: input.payload.threadId || null,
            commentId: input.payload.commentId || null,
            igUserId: input.payload.igUserId || null,
            externalId: null,
            reasonCode: input.error.reasonCode,
            failureMessage: input.error.message,
            retryable: input.error.retryable,
            finalFailure: input.finalFailure,
            responsePreview: (input.responseText || "").slice(0, 300),
        },
    }).catch((error) => {
        logError("instagram.outbound.webhook_emit_failed", error, {
            workspaceId: input.payload.workspaceId,
            channelId: input.payload.channelId,
            eventId: input.payload.eventId,
        });
    });

    if (input.notifyOperator) {
        await deps.sendOperatorReport([
            "[Instagram Outbound Failed]",
            `Workspace: ${input.payload.workspaceId}`,
            `Channel: ${input.payload.channelId}`,
            `Event: ${input.payload.eventType}:${input.payload.eventId}`,
            `Thread: ${input.payload.threadId || "-"}`,
            `Comment: ${input.payload.commentId || "-"}`,
            `Reason: ${input.error.reasonCode}`,
            `Error: ${input.error.message.slice(0, 400)}`,
            input.responseText?.trim() ? `AI Response: ${input.responseText.slice(0, 300)}` : "",
        ].filter(Boolean).join("\n"), {
            workspaceId: input.payload.workspaceId,
        }).catch(() => null);
    }
}

function createLocalRateLimitError(details: {
    channelId: string;
    tenantCount: number;
    tenantLimit: number;
    channelCount: number;
    channelLimit: number;
}) {
    return new InstagramOutboundError({
        message: `Instagram outbound rate limit exceeded channel=${details.channelId} channelCount=${details.channelCount}/${details.channelLimit} tenantCount=${details.tenantCount}/${details.tenantLimit}`,
        classification: "rate_limit",
        reasonCode: "local_rate_limit_exceeded",
        retryable: true,
    });
}

export function createInstagramWebhookJobProcessor(
    overrides: Partial<InstagramWebhookWorkerDeps> = {}
) {
    const deps: InstagramWebhookWorkerDeps = {
        ...defaultInstagramWebhookWorkerDeps(),
        ...overrides,
    };

    return async function processInstagramWebhookJob(job: Job<InstagramWebhookQueueJob>) {
        const batch = await deps.consumeInstagramInboundDebouncedBatch(job);
        if (!batch) {
            return;
        }

        const payload = batch.data;
        const lagMs = safeQueueLagMs(Date.now() - (payload.firstBufferedAt || payload.receivedAt || Date.now()));
        await deps.recordQueueLag({
        queueName: job.queueName,
        workspaceId: payload.workspaceId,
        channelId: payload.channelId,
        lagMs,
    });
        deps.logInfo("instagram.webhook.worker.processing", {
        queueName: job.queueName,
        jobId: job.id,
        eventId: payload.eventId,
        eventType: payload.eventType,
        igUserId: payload.igUserId,
        threadId: payload.threadId,
        lagMs,
        batchCount: batch.batchCount,
    });

        const channel = await deps.prisma.channel.findFirst({
        where: {
            id: payload.channelId,
            workspaceId: payload.workspaceId,
            providerType: ChannelProvider.INSTAGRAM,
        },
        select: {
            id: true,
            workspaceId: true,
            isEnabled: true,
            status: true,
            rateLimitPerSecond: true,
        },
    });

        if (!channel || !channel.isEnabled || channel.status === "removed") {
            throw new Error(`Instagram channel inactive ${payload.channelId}`);
        }

        await deps.prisma.instagramChannelConfig.updateMany({
        where: {
            workspaceId: payload.workspaceId,
            channelId: payload.channelId,
        },
        data: {
            lastWebhookAt: new Date(payload.receivedAt || Date.now()),
        },
    });

        const user = await (async () => {
        if (payload.igUserId || payload.igUsername) {
            return deps.userRepo.upsertUserByChannelIdentity({
                workspaceId: payload.workspaceId,
                provider: "instagram",
                externalUserId: payload.igUserId,
                username: payload.igUsername,
                name: payload.igUsername ? `@${payload.igUsername}` : undefined,
            });
        }

        const fallbackIdentifier = resolveInstagramUserIdentifier(payload);
        return deps.userRepo.upsertUser(fallbackIdentifier, payload.workspaceId, payload.igUsername ? `@${payload.igUsername}` : undefined);
        })();
        const launchMode = resolveInstagramLaunchMode(payload.workspaceId);
        if (launchMode.fallbackActive) {
            await deps.saveMessage({
                workspaceId: payload.workspaceId,
                userId: user.id,
                role: "user",
                content: (payload.messageText || "").trim() || buildEventPlaceholder(payload),
                metadata: {
                    ...buildMessageMetadata(payload, batch.batchCount),
                    autoReplySkippedReason: "meta-development-mode-fallback",
                },
            });

            await deps.createAudit(payload.channelId, {
                eventType: "instagram_webhook_skipped_development_mode",
                status: "skipped",
                message: `${payload.eventType}:${payload.eventId}`,
                metadata: {
                    appMode: launchMode.appMode,
                    workspaceAllowed: launchMode.workspaceAllowed,
                    allowedWorkspaceIds: launchMode.allowedWorkspaceIds,
                },
            });
            return;
        }
        const messageText = (payload.messageText || "").trim() || buildEventPlaceholder(payload);
        const inboundUsage = await deps.billingService.consumeUsage({
        workspaceId: payload.workspaceId,
        channelId: payload.channelId,
        metric: UsageMetric.IG_INBOUND,
        quantity: 1,
        referenceId: payload.eventId,
        metadata: {
            eventId: payload.eventId,
            eventType: payload.eventType,
            eventKey: payload.eventKey,
            threadId: payload.threadId,
            commentId: payload.commentId,
            mediaId: payload.mediaId,
            igUserId: payload.igUserId,
            sourceEventIds: payload.sourceEventIds,
            batchCount: batch.batchCount,
        },
    });

        if (!inboundUsage.allowed) {
            await deps.saveMessage({
            workspaceId: payload.workspaceId,
            userId: user.id,
            role: "user",
            content: messageText,
            metadata: {
                ...buildMessageMetadata(payload, batch.batchCount),
                autoReplySkippedReason: "billing-inbound-hard-limit",
            },
        });

            await deps.createAudit(payload.channelId, {
            eventType: "instagram_inbound_billing_blocked",
            status: "rejected",
            message: `${payload.eventType}:${payload.eventId}`,
            metadata: {
                metric: UsageMetric.IG_INBOUND,
                used: inboundUsage.used,
                projected: inboundUsage.projected,
                limit: inboundUsage.limit,
                threadId: payload.threadId,
                commentId: payload.commentId,
                mediaId: payload.mediaId,
            },
        });
            return;
        }

        if (inboundUsage.softLimitReached) {
            await deps.createAudit(payload.channelId, {
            eventType: "instagram_inbound_soft_limit_warning",
            status: "warning",
            message: `${payload.eventType}:${payload.eventId}`,
            metadata: {
                metric: UsageMetric.IG_INBOUND,
                used: inboundUsage.used,
                projected: inboundUsage.projected,
                limit: inboundUsage.limit,
                threadId: payload.threadId,
            },
        });
            deps.logWarn("instagram.billing.soft_limit_warning", {
            metric: UsageMetric.IG_INBOUND,
            used: inboundUsage.used,
            projected: inboundUsage.projected,
            limit: inboundUsage.limit,
        });
        }

        if (payload.threadId) {
            const autoReplyState = await deps.getInstagramThreadAutoReplyState(
            payload.workspaceId,
            payload.threadId,
            payload.channelId
        );
            if (autoReplyState && !autoReplyState.enabled) {
                await deps.saveMessage({
                workspaceId: payload.workspaceId,
                userId: user.id,
                role: "user",
                content: messageText,
                metadata: {
                    ...buildMessageMetadata(payload, batch.batchCount),
                    autoReplySkippedReason: "thread-auto-reply-disabled",
                },
            });

                await deps.createAudit(payload.channelId, {
                eventType: "instagram_webhook_skipped_thread_auto_reply_disabled",
                status: "skipped",
                message: `${payload.eventType}:${payload.eventId}`,
                metadata: {
                    threadId: payload.threadId,
                    eventId: payload.eventId,
                    eventKey: payload.eventKey,
                    batchCount: batch.batchCount,
                    autoReplyUpdatedAt: autoReplyState.updatedAt?.toISOString() || null,
                },
            });
                return;
            }

            const hasHumanOverride = await deps.hasHumanOperatorReplyInInstagramThreadSince(
            payload.workspaceId,
            payload.threadId,
            new Date(batch.firstBufferedAt),
            payload.channelId
        );

            if (hasHumanOverride) {
                await deps.saveMessage({
                workspaceId: payload.workspaceId,
                userId: user.id,
                role: "user",
                content: messageText,
                metadata: {
                    ...buildMessageMetadata(payload, batch.batchCount),
                    autoReplySkippedReason: "human-operator-replied",
                },
            });

                await deps.markPending({
                workspaceId: payload.workspaceId,
                phoneNumber: resolveInstagramUserIdentifier(payload),
                userId: user.id,
                topic: "instagram_thread_human_override",
                keyword: payload.threadId,
                triggeredBy: "human_override",
                lastUserMessage: messageText.slice(0, 500),
            });

                await deps.createAudit(payload.channelId, {
                eventType: "instagram_webhook_skipped_human_override",
                status: "skipped",
                message: `${payload.eventType}:${payload.eventId}`,
                metadata: {
                    threadId: payload.threadId,
                    eventId: payload.eventId,
                    eventKey: payload.eventKey,
                    batchCount: batch.batchCount,
                },
            });

                return;
            }
        }

        const [rules, botConfig] = await Promise.all([
            deps.getWorkspaceInstagramAutoReplyRules(payload.workspaceId),
            deps.getBotConfig(payload.workspaceId),
        ]);
        const autoReplyRule = deps.evaluateInstagramAutoReplyRule({
            eventType: payload.eventType,
            messageText,
            rules,
            businessHours: {
                timezone: botConfig.timezone,
                businessHoursStart: botConfig.businessHoursStart,
                businessHoursEnd: botConfig.businessHoursEnd,
                businessDays: botConfig.businessDays,
                outOfHoursAutoReplyEnabled: botConfig.outOfHoursAutoReplyEnabled,
                outOfHoursMessage: botConfig.outOfHoursMessage,
            },
        });

        if (!autoReplyRule.allowed) {
            await deps.saveMessage({
                workspaceId: payload.workspaceId,
                userId: user.id,
                role: "user",
                content: messageText,
                metadata: {
                    ...buildMessageMetadata(payload, batch.batchCount),
                    autoReplySkippedReason: autoReplyRule.reason,
                    autoReplyMatchedKeywords: autoReplyRule.matchedKeywords,
                    autoReplySentimentScore: autoReplyRule.sentimentScore,
                    autoReplyFallbackMessage: autoReplyRule.fallbackMessage || null,
                },
            });

            await deps.createAudit(payload.channelId, {
                eventType: "instagram_webhook_skipped_auto_reply_rule",
                status: "skipped",
                message: `${payload.eventType}:${payload.eventId}`,
                metadata: {
                    eventId: payload.eventId,
                    eventKey: payload.eventKey,
                    threadId: payload.threadId,
                    commentId: payload.commentId,
                    mediaId: payload.mediaId,
                    batchCount: batch.batchCount,
                    reason: autoReplyRule.reason,
                    matchedKeywords: autoReplyRule.matchedKeywords,
                    sentimentScore: autoReplyRule.sentimentScore,
                    fallbackMessage: autoReplyRule.fallbackMessage || null,
                },
            });
            return;
        }

        const response = await deps.runAgent(
        resolveInstagramUserIdentifier(payload),
        messageText,
        payload.igUsername ? `@${payload.igUsername}` : undefined,
        payload.workspaceId,
        payload.channelId,
        {
            source: payload.eventType,
            provider: "instagram",
            skipInboundBilling: true,
            externalUserId: payload.igUserId,
            username: payload.igUsername,
            threadId: payload.threadId,
            commentId: payload.commentId,
            mediaId: payload.mediaId,
            eventId: payload.eventId,
            eventKey: payload.eventKey,
            batchCount: batch.batchCount,
            sourceEventIds: payload.sourceEventIds,
        }
    );

        await deps.createAudit(payload.channelId, {
        eventType: response.trim()
            ? "instagram_agent_response_generated"
            : "instagram_agent_response_empty",
        status: response.trim() ? "success" : "skipped",
        message: `${payload.eventType}:${payload.eventId}`,
        metadata: {
            eventId: payload.eventId,
            eventKey: payload.eventKey,
            threadId: payload.threadId,
            commentId: payload.commentId,
            mediaId: payload.mediaId,
            batchCount: batch.batchCount,
            responsePreview: response.slice(0, 300),
        },
    });

        const responseText = response.trim();
        if (!responseText) {
            return;
        }

        const policy = evaluateInstagramOutboundPolicy({
        eventType: payload.eventType,
        occurredAt: payload.occurredAt,
        responseText,
    });

        if (!policy.ok) {
            await persistOutboundFailure({
            payload,
            responseText,
            batchCount: batch.batchCount,
            error: new InstagramOutboundError({
                message: policy.message || "Instagram outbound policy rejected",
                classification: "policy_error",
                reasonCode: policy.reasonCode || "policy_rejected",
                retryable: false,
            }),
            attempt: currentAttempt(job),
            finalFailure: true,
                notifyOperator: false,
            }, deps);
            return;
        }

        const rateLimit = await deps.consumeInstagramOutboundRateLimit({
        workspaceId: payload.workspaceId,
        channelId: payload.channelId,
        channelLimitPerSecond: channel.rateLimitPerSecond,
    });
        if (!rateLimit.ok) {
            throw createLocalRateLimitError({
            channelId: payload.channelId,
            tenantCount: rateLimit.tenantCount,
            tenantLimit: rateLimit.tenantLimit,
            channelCount: rateLimit.channelCount,
            channelLimit: rateLimit.channelLimit,
            });
        }

        const outboundUsageMetric = usageMetricForOutbound(payload.eventType);
        const outboundUsage = await deps.billingService.consumeUsage({
        workspaceId: payload.workspaceId,
        channelId: payload.channelId,
        metric: outboundUsageMetric,
        quantity: 1,
        referenceId: payload.eventId,
        metadata: {
            eventId: payload.eventId,
            eventType: payload.eventType,
            eventKey: payload.eventKey,
            threadId: payload.threadId,
            commentId: payload.commentId,
            mediaId: payload.mediaId,
            igUserId: payload.igUserId,
            outboundTarget: outboundTargetFromEvent(payload),
        },
    });

        if (!outboundUsage.allowed) {
            await persistOutboundFailure({
            payload,
            responseText,
            batchCount: batch.batchCount,
            error: new InstagramOutboundError({
                message: "Instagram outbound quota reached for current billing cycle",
                classification: "policy_error",
                reasonCode: "billing_limit_reached",
                retryable: false,
            }),
            attempt: currentAttempt(job),
            finalFailure: true,
                notifyOperator: false,
            }, deps);
            return;
        }

        if (outboundUsage.softLimitReached) {
            await deps.createAudit(payload.channelId, {
            eventType: "instagram_outbound_soft_limit_warning",
            status: "warning",
            message: `${payload.eventType}:${payload.eventId}`,
            metadata: {
                metric: outboundUsageMetric,
                used: outboundUsage.used,
                projected: outboundUsage.projected,
                limit: outboundUsage.limit,
                outboundTarget: outboundTargetFromEvent(payload),
                threadId: payload.threadId,
                commentId: payload.commentId,
            },
        });
            deps.logWarn("instagram.billing.soft_limit_warning", {
            metric: outboundUsageMetric,
            used: outboundUsage.used,
            projected: outboundUsage.projected,
            limit: outboundUsage.limit,
        });
        }

        const outboundResult = payload.eventType === "instagram-comment"
            ? await deps.replyInstagramComment({
            workspaceId: payload.workspaceId,
            channelId: payload.channelId,
            commentId: payload.commentId || "",
            text: responseText,
        })
            : await deps.sendInstagramDirectMessage({
            workspaceId: payload.workspaceId,
            channelId: payload.channelId,
            recipientIgUserId: payload.igUserId || "",
            text: responseText,
            });

        if (!outboundResult.ok) {
            if (outboundResult.error.retryable) {
                throw outboundResult.error;
            }

            await persistOutboundFailure({
                payload,
                responseText,
                batchCount: batch.batchCount,
                error: outboundResult.error,
                attempt: currentAttempt(job),
                finalFailure: true,
                notifyOperator: true,
            }, deps);
            return;
        }

        await persistOutboundSuccess({
            payload,
            responseText,
            batchCount: batch.batchCount,
            outboundResult,
            attempt: currentAttempt(job),
        }, deps);
    };
}

const instagramWebhookWorkerDeps = defaultInstagramWebhookWorkerDeps();
const processInstagramWebhookJob = createInstagramWebhookJobProcessor(instagramWebhookWorkerDeps);

export function startInstagramWebhookWorkerForPartition(workspaceId: string, channelId: string) {
    const queueName = getInstagramWebhookQueueName(workspaceId, channelId);
    const existing = workersByQueue.get(queueName);
    if (existing) {
        return existing;
    }

    const concurrency = resolveConcurrency();

    const worker = new Worker<InstagramWebhookQueueJob>(
        queueName,
        async (job) => withObservationContext({
            workspaceId: job.data.workspaceId,
            channelId: job.data.channelId,
            correlationId: job.data.correlationId,
            traceId: job.data.traceId,
            provider: "instagram",
            igUserId: job.data.igUserId,
            threadId: job.data.threadId,
            eventId: job.data.eventId,
            eventType: job.data.eventType,
            queueName: job.queueName,
            jobId: String(job.id || ""),
            messageId: job.data.messageId,
            component: "instagram-webhook-worker",
        }, async () => {
            await processInstagramWebhookJob(job);
        }),
        {
            connection: redis,
            concurrency: concurrency.initial,
        }
    );

    worker.on("completed", async (job) => {
        await recordWorkerThroughput({
            queueName: job.queueName,
            workspaceId: job.data.workspaceId,
            channelId: job.data.channelId,
            status: "processed",
        });

        logInfo("instagram.webhook.worker.completed", {
            queueName: job.queueName,
            jobId: job.id,
            eventId: job.data.eventId,
            eventType: job.data.eventType,
        });
    });

    worker.on("failed", async (job, err) => {
        if (!job) {
            logError("instagram.webhook.worker.failed_without_job", err, { queueName });
            return;
        }

        const finalFailure = isFinalFailure(job);
        const outboundError = toInstagramOutboundError(err);

        if (finalFailure) {
            await recordWorkerThroughput({
                queueName: job.queueName,
                workspaceId: job.data.workspaceId,
                channelId: job.data.channelId,
                status: "failed",
            });

            if (err instanceof InstagramOutboundError) {
                await persistOutboundFailure({
                    payload: job.data,
                    batchCount: Math.max(1, Number(job.data.debouncedCount || 1)),
                    error: outboundError,
                    attempt: Math.max(1, job.attemptsMade),
                    finalFailure: true,
                    notifyOperator: true,
                }, instagramWebhookWorkerDeps).catch((persistError) => {
                    logError("instagram.webhook.worker.persist_outbound_failure_failed", persistError, {
                        queueName: job.queueName,
                        jobId: job.id,
                    });
                });
            }

            try {
                await enqueueDeadLetter(job, outboundError);
            } catch (dlqError) {
                logError("instagram.webhook.worker.dlq_enqueue_failed", dlqError, {
                    queueName: job.queueName,
                    jobId: job.id,
                });
            }
        }

        logError("instagram.webhook.worker.failed", outboundError, {
            queueName: job.queueName,
            jobId: job.id,
            attemptsMade: job.attemptsMade,
            finalFailure,
        });
    });

    worker.on("error", (err) => {
        logError("instagram.webhook.worker.error", err, { queueName });
    });

    workersByQueue.set(queueName, worker);
    startQueueAutoscaler({
        workerType: "instagram-webhook",
        queueName,
        workerRef: worker,
        config: concurrency,
    });
    logInfo("instagram.webhook.worker.started", {
        queueName,
        concurrency: concurrency.initial,
        minConcurrency: concurrency.min,
        maxConcurrency: concurrency.max,
        autoscaleIntervalMs: concurrency.intervalMs,
        autoscaleTargetBacklog: concurrency.targetBacklog,
    });

    return worker;
}
