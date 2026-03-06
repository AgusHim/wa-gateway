import { getDefaultTenantContext } from "../lib/tenant/context";
import { UsageMetric } from "@prisma/client";
import { logError, logInfo, logWarn } from "../lib/observability/logger";
import { withTraceSpan } from "../lib/observability/trace";

export type AgentExecutor = (
    phoneNumber: string,
    incomingMessage: string,
    pushName?: string
) => Promise<string>;

const NON_PERSISTED_ASSISTANT_MARKERS = [
    "Maaf, terjadi kesalahan saat memproses pesan kamu.",
    "Maaf, sistem sedang mengalami kendala.",
];

function shouldPersistAssistantMessage(content: string): boolean {
    const normalized = content.trim();
    if (!normalized) return false;
    return !NON_PERSISTED_ASSISTANT_MARKERS.some((marker) => normalized.includes(marker));
}

export async function runAgentWithExecutor(
    executor: AgentExecutor,
    phoneNumber: string,
    incomingMessage: string,
    pushName?: string
): Promise<string> {
    try {
        return await executor(phoneNumber, incomingMessage, pushName);
    } catch (error) {
        logError("agent.executor.failed", error, {
            component: "runner",
            phoneNumber,
        });
        return "Maaf, sistem sedang mengalami kendala. Coba lagi sebentar ya 🙏";
    }
}

/**
 * Main runner entrypoint for inbound WhatsApp messages.
 */
export async function runAgent(
    phoneNumber: string,
    incomingMessage: string,
    pushName?: string,
    workspaceIdInput?: string,
    channelIdInput?: string
): Promise<string> {
    return withTraceSpan("pipeline.agent.run", async () => {
        const [
            { configRepo },
            { billingService },
            { messageRepo },
            { userRepo },
            { handoverRepo },
            { detectHumanHandoverTopic },
            { detectConversationIntent, deriveSegmentsFromIntent, shouldEscalateFromIntent },
            { isWithinBusinessHours, resolveOutOfHoursAutoReply },
            { campaignService },
            { webhookService },
            { sendOperatorReport },
            { getWorkspaceRuntimeFlags },
            { recordAiLatency },
        ] = await Promise.all([
            import("../lib/db/configRepo"),
            import("../lib/billing/service"),
            import("../lib/db/messageRepo"),
            import("../lib/db/userRepo"),
            import("../lib/handover/repo"),
            import("../lib/handover/topicGuard"),
            import("../lib/automation/intentRouter"),
            import("../lib/automation/businessHours"),
            import("../lib/automation/campaignService"),
            import("../lib/integrations/webhookService"),
            import("../lib/baileys/client"),
            import("../lib/tenant/flags"),
            import("../lib/observability/metrics"),
        ]);

        const { workspaceId: defaultWorkspaceId, channelId: defaultChannelId } = getDefaultTenantContext();
        const workspaceId = workspaceIdInput || defaultWorkspaceId;
        const channelId = channelIdInput || defaultChannelId;
        const runtimeFlags = await getWorkspaceRuntimeFlags(workspaceId);
        if (!runtimeFlags.allowAgent) {
            return "Maaf, workspace Anda sedang tidak aktif untuk memproses pesan.";
        }

        const config = await configRepo.getBotConfig(workspaceId);
        if (!config.isActive) {
            return "Maaf, bot sedang tidak aktif. Silakan coba lagi nanti.";
        }

        const inboundUsage = await billingService.consumeUsage({
            workspaceId,
            channelId,
            metric: UsageMetric.INBOUND_MESSAGE,
            quantity: 1,
            referenceId: phoneNumber,
            metadata: {
                source: "wa-inbound",
            },
        });

        if (!inboundUsage.allowed) {
            return "Kuota pesan bulanan paket Anda sudah habis. Silakan upgrade plan untuk melanjutkan.";
        }

        const user = await userRepo.upsertUser(phoneNumber, workspaceId, pushName);
        if (user.isBlocked) {
            return "";
        }

        await campaignService.recordInboundReply(workspaceId, phoneNumber, incomingMessage);

        const intent = detectConversationIntent(incomingMessage);
        const intentSegments = deriveSegmentsFromIntent(intent.intent);
        if (intentSegments.length > 0) {
            await userRepo.mergeSegments(user.id, workspaceId, intentSegments);
        }

        await messageRepo.saveMessage({
            workspaceId,
            userId: user.id,
            role: "user",
            content: incomingMessage,
            metadata: {
                channelId,
                intent: intent.intent,
                intentConfidence: intent.confidence,
                intentKeywords: intent.matchedKeywords,
                autoSegments: intentSegments,
            },
        });

        webhookService.enqueueEvent({
            workspaceId,
            eventType: "MESSAGE_RECEIVED",
            payload: {
                userId: user.id,
                phoneNumber,
                pushName: pushName || null,
                message: incomingMessage,
                intent: intent.intent,
                intentConfidence: intent.confidence,
            },
        }).catch((error) => {
            logError("agent.webhook_emit_failed.message_received", error, {
                component: "runner",
                workspaceId,
                userId: user.id,
            });
        });

        if (await handoverRepo.isPending(phoneNumber, workspaceId)) {
            return "";
        }

        const handoverMatch = detectHumanHandoverTopic(incomingMessage);
        const escalationFromIntent = shouldEscalateFromIntent(intent.intent);
        if (handoverMatch.requiresHuman || escalationFromIntent) {
            const handoverTopic = handoverMatch.topic || (escalationFromIntent ? "intent_escalation" : undefined);
            const handoverKeyword = handoverMatch.keyword || (escalationFromIntent ? intent.intent : undefined);
            await handoverRepo.markPending({
                workspaceId,
                phoneNumber,
                userId: user.id,
                topic: handoverTopic,
                keyword: handoverKeyword,
                triggeredBy: handoverMatch.requiresHuman ? "keyword_match" : "intent_router",
                lastUserMessage: incomingMessage.slice(0, 500),
            });

            await messageRepo.saveMessage({
                workspaceId,
                userId: user.id,
                role: "system",
                content: `[Handover] User membutuhkan bantuan agent manusia. Topik: ${handoverTopic || "unknown"}`,
                metadata: {
                    source: "human-handover",
                    topic: handoverTopic,
                    keyword: handoverKeyword,
                    channelId,
                    intent: intent.intent,
                },
            });

            webhookService.enqueueEvent({
                workspaceId,
                eventType: "HANDOVER_CREATED",
                payload: {
                    userId: user.id,
                    phoneNumber,
                    pushName: pushName || null,
                    topic: handoverTopic || null,
                    keyword: handoverKeyword || null,
                    intent: intent.intent,
                    message: incomingMessage,
                },
            }).catch((error) => {
                logError("agent.webhook_emit_failed.handover_created", error, {
                    component: "runner",
                    workspaceId,
                    userId: user.id,
                });
            });

            try {
                await sendOperatorReport(
                    `[Human Handover]\nPhone: ${phoneNumber}\nName: ${pushName || "-"}\nTopic: ${handoverTopic || "-"}\nKeyword: ${handoverKeyword || "-"}\nIntent: ${intent.intent}\nMessage: ${incomingMessage.slice(0, 300)}`,
                    { channelId, workspaceId }
                );
            } catch (error) {
                logWarn("agent.handover_report_failed", {
                    component: "runner",
                    workspaceId,
                    userId: user.id,
                    reason: error instanceof Error ? error.message : String(error),
                });
            }

            return "Permintaan Anda sudah kami eskalasi ke tim support manusia. Tim kami akan menindaklanjuti secepatnya.";
        }

        if (
            config.outOfHoursAutoReplyEnabled
            && !isWithinBusinessHours({
                timezone: config.timezone,
                businessHoursStart: config.businessHoursStart,
                businessHoursEnd: config.businessHoursEnd,
                businessDays: config.businessDays,
                outOfHoursAutoReplyEnabled: config.outOfHoursAutoReplyEnabled,
                outOfHoursMessage: config.outOfHoursMessage,
            })
        ) {
            const autoReply = resolveOutOfHoursAutoReply({
                timezone: config.timezone,
                businessHoursStart: config.businessHoursStart,
                businessHoursEnd: config.businessHoursEnd,
                businessDays: config.businessDays,
                outOfHoursAutoReplyEnabled: config.outOfHoursAutoReplyEnabled,
                outOfHoursMessage: config.outOfHoursMessage,
            });

            await messageRepo.saveMessage({
                workspaceId,
                userId: user.id,
                role: "assistant",
                content: autoReply,
                metadata: {
                    source: "business-hours-auto-reply",
                    channelId,
                },
            });

            return autoReply;
        }

        const { invokeAgentGraphDetailed } = await import("./graph");
        const graphStart = Date.now();
        const graphResult = await withTraceSpan("pipeline.agent.graph_invoke", async () => invokeAgentGraphDetailed({
            workspaceId,
            userId: user.id,
            channelId,
            phoneNumber,
            incomingMessage,
            pushName,
            maxIterations: 5,
        }), {
            component: "runner",
            workspaceId,
            channelId,
        });
        const response = graphResult.response;
        const aiLatencyMs = Date.now() - graphStart;

        await recordAiLatency({
            workspaceId,
            channelId,
            latencyMs: aiLatencyMs,
            model: graphResult.metadata.model,
        });
        logInfo("agent.graph.completed", {
            component: "runner",
            workspaceId,
            channelId,
            model: graphResult.metadata.model,
            latencyMs: aiLatencyMs,
            totalTokens: graphResult.metadata.totalTokens,
        });

        if (graphResult.metadata.totalTokens > 0) {
            await billingService.recordUsageEvent({
                workspaceId,
                channelId,
                metric: UsageMetric.AI_TOKEN,
                quantity: graphResult.metadata.totalTokens,
                referenceId: user.id,
                metadata: {
                    model: graphResult.metadata.model,
                    inputTokens: graphResult.metadata.inputTokens,
                    outputTokens: graphResult.metadata.outputTokens,
                    totalTokens: graphResult.metadata.totalTokens,
                },
            });
        }

        const responseWithWarning = inboundUsage.softLimitReached
            ? `${response}\n\n[Info Billing] Pemakaian paket mendekati limit bulanan.`
            : response;

        if (shouldPersistAssistantMessage(responseWithWarning)) {
            await messageRepo.saveMessage({
                workspaceId,
                userId: user.id,
                role: "assistant",
                content: responseWithWarning,
                metadata: {
                    model: graphResult.metadata.model,
                    inputTokens: graphResult.metadata.inputTokens,
                    outputTokens: graphResult.metadata.outputTokens,
                    totalTokens: graphResult.metadata.totalTokens,
                    softLimitWarning: inboundUsage.softLimitReached,
                    channelId,
                },
            });
        } else {
            logWarn("agent.response.skipped_persist", {
                component: "runner",
                workspaceId,
                channelId,
                phoneNumber,
            });
        }

        return responseWithWarning;
    }, {
        component: "runner",
        workspaceId: workspaceIdInput || getDefaultTenantContext().workspaceId,
        channelId: channelIdInput || getDefaultTenantContext().channelId,
    }).catch((error) => {
        logError("agent.run.failed", error, {
            component: "runner",
            workspaceId: workspaceIdInput || getDefaultTenantContext().workspaceId,
            channelId: channelIdInput || getDefaultTenantContext().channelId,
            phoneNumber,
        });
        throw error;
    });
}
