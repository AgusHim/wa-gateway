import { Job } from "bullmq";
import { UsageMetric } from "@prisma/client";
import { connectToWhatsApp, sendMessage, sendOperatorReport, sendTyping } from "../lib/baileys/client";
import {
    startInboundWorkerForPartition,
    startOutboundWorkerForPartition,
    startWorker,
} from "../lib/queue/worker";
import {
    InboundMessageJob,
    OutboundSendJob,
    getOutboundSendQueue,
} from "../lib/queue/messageQueue";
import { loadAllInstructions } from "../lib/instructions/loader";
import { runAgent } from "./runner";
import { initializeTools } from "./tools/init";
import { evaluateOutboundPolicy, consumeOutboundRateLimit } from "@/lib/wa/compliance";
import { billingService } from "@/lib/billing/service";
import { startMemoryRetentionScheduler } from "@/lib/memory/maintenance";
import { campaignService } from "@/lib/automation/campaignService";
import { webhookService } from "@/lib/integrations/webhookService";
import { withTraceSpan } from "@/lib/observability/trace";
import { logError, logInfo } from "@/lib/observability/logger";
import { recordDeliveryResult } from "@/lib/observability/metrics";
import { getWorkspaceRuntimeFlags } from "@/lib/tenant/flags";

let inboundProcessorRef: ((job: Job<InboundMessageJob>) => Promise<void>) | null = null;
let outboundProcessorRef: ((job: Job<OutboundSendJob>) => Promise<void>) | null = null;

function createInboundProcessor() {
    return async (job: Job<InboundMessageJob>) => withTraceSpan("pipeline.inbound.process", async () => {
        const { workspaceId, channelId, phoneNumber, messageText, pushName } = job.data;
        const { channelRepo } = await import("../lib/db/channelRepo");

        try {
            logInfo("pipeline.inbound.agent_start", {
                phoneNumber,
                preview: messageText.slice(0, 120),
            });

            const response = await runAgent(phoneNumber, messageText, pushName, workspaceId, channelId);
            logInfo("pipeline.inbound.agent_completed", {
                phoneNumber,
                responsePreview: response.slice(0, 200),
                hasResponse: Boolean(response),
            });

            if (!response) {
                return;
            }

            const targetChannelId = channelId || (await channelRepo.getPrimaryWorkspaceChannel(workspaceId))?.id;
            if (!targetChannelId) {
                throw new Error(`No active channel for workspace=${workspaceId}`);
            }

            const queue = getOutboundSendQueue(workspaceId, targetChannelId);
            await queue.add(`agent-send:${targetChannelId}`, {
                workspaceId,
                channelId: targetChannelId,
                phoneNumber,
                text: response,
                mode: "chat",
                requestedAt: Date.now(),
                traceId: job.data.traceId,
                correlationId: job.data.correlationId,
                sourceMessageId: job.data.messageId,
            });
        } catch (error) {
            logError("pipeline.inbound.process_failed", error, {
                phoneNumber,
            });

            const errText = error instanceof Error ? error.message : String(error);
            try {
                await sendOperatorReport(
                    `[Gateway Error]\nFrom: ${phoneNumber}\nMessage: ${messageText.slice(0, 200)}\nError: ${errText}`,
                    { channelId }
                );
            } catch (reportErr) {
                logError("pipeline.inbound.operator_report_failed", reportErr);
            }

            throw error;
        }
    }, {
        component: "inbound-processor",
    });
}

function createOutboundProcessor() {
    return async (job: Job<OutboundSendJob>) => withTraceSpan("pipeline.outbound.process", async () => {
        const {
            workspaceId,
            channelId,
            phoneNumber,
            text,
            mode = "chat",
            templateId,
            campaignRecipientId,
        } = job.data;

        const { channelRepo } = await import("../lib/db/channelRepo");

        logInfo("pipeline.outbound.send_start", {
            phoneNumber,
            channelId,
            mode,
        });

        try {
            const runtimeFlags = await getWorkspaceRuntimeFlags(workspaceId);
            if (!runtimeFlags.allowOutbound) {
                throw new Error(`workspace is not allowed to send outbound messages (${workspaceId})`);
            }

            const channel = await channelRepo.getWorkspaceChannel(workspaceId, channelId);
            if (!channel || !channel.isEnabled || channel.status === "removed") {
                throw new Error(`Channel ${channelId} is not active`);
            }

            const policyResult = await evaluateOutboundPolicy({
                workspaceId,
                channelId,
                phoneNumber,
                mode,
                templateId,
            });
            if (!policyResult.ok) {
                await channelRepo.createAudit(channelId, {
                    eventType: "outbound_policy_blocked",
                    status: "rejected",
                    message: policyResult.message,
                    metadata: {
                        phoneNumber,
                        mode,
                        templateId,
                        violations: policyResult.violations,
                    },
                });
                if (campaignRecipientId) {
                    await campaignService.markRecipientFailed(campaignRecipientId, policyResult.message || "policy_rejected");
                }
                return;
            }

            const rateLimitResult = await consumeOutboundRateLimit({
                workspaceId,
                channelId,
                channelLimitPerSecond: channel.rateLimitPerSecond,
            });
            if (!rateLimitResult.ok) {
                throw new Error(
                    `Outbound rate limit exceeded channel=${channelId} channelCount=${rateLimitResult.channelCount}/${rateLimitResult.channelLimit} tenantCount=${rateLimitResult.tenantCount}/${rateLimitResult.tenantLimit}`
                );
            }

            const outboundUsage = await billingService.consumeUsage({
                workspaceId,
                channelId,
                metric: UsageMetric.OUTBOUND_MESSAGE,
                quantity: 1,
                referenceId: phoneNumber,
                metadata: {
                    source: mode === "chat" ? "chat-outbound" : `${mode}-outbound`,
                    templateId,
                },
            });
            if (!outboundUsage.allowed) {
                await channelRepo.createAudit(channelId, {
                    eventType: "outbound_billing_blocked",
                    status: "rejected",
                    message: "Outbound message limit reached",
                    metadata: {
                        phoneNumber,
                        mode,
                        templateId,
                    },
                });
                if (campaignRecipientId) {
                    await campaignService.markRecipientFailed(campaignRecipientId, "billing_limit_reached");
                }
                return;
            }

            await sendTyping(phoneNumber, text.length, { channelId, workspaceId });
            await sendMessage(phoneNumber, text, { withTyping: false, channelId, workspaceId });
            await recordDeliveryResult({ workspaceId, channelId, success: true });

            if (campaignRecipientId) {
                await campaignService.markRecipientSent(campaignRecipientId);
            }
            webhookService.enqueueEvent({
                workspaceId,
                eventType: "MESSAGE_SENT",
                payload: {
                    channelId,
                    phoneNumber,
                    mode,
                    templateId: templateId || null,
                    campaignRecipientId: campaignRecipientId || null,
                    textPreview: text.slice(0, 300),
                },
            }).catch((eventError) => {
                logError("pipeline.outbound.webhook_emit_failed", eventError);
            });

            logInfo("pipeline.outbound.send_success", {
                phoneNumber,
                channelId,
                mode,
            });
        } catch (error) {
            if (campaignRecipientId) {
                const message = error instanceof Error ? error.message : String(error);
                await campaignService.markRecipientFailed(campaignRecipientId, message);
            }
            throw error;
        }
    }, {
        component: "outbound-processor",
    });
}

function ensureProcessorRefsInitialized() {
    if (!inboundProcessorRef) {
        inboundProcessorRef = createInboundProcessor();
    }

    if (!outboundProcessorRef) {
        outboundProcessorRef = createOutboundProcessor();
    }
}

export function ensureInboundPartitionWorker(workspaceId: string, channelId: string) {
    ensureProcessorRefsInitialized();
    return startInboundWorkerForPartition(workspaceId, channelId, inboundProcessorRef as (job: Job<InboundMessageJob>) => Promise<void>);
}

export function ensureOutboundPartitionWorker(workspaceId: string, channelId: string) {
    ensureProcessorRefsInitialized();
    return startOutboundWorkerForPartition(workspaceId, channelId, outboundProcessorRef as (job: Job<OutboundSendJob>) => Promise<void>);
}

/**
 * Bootstrap the entire agent system.
 * Call this once at app startup.
 */
export async function bootstrap(): Promise<void> {
    logInfo("gateway.bootstrap.start", {
        component: "bootstrap",
    });

    // 1. Pre-load instruction files
    loadAllInstructions();
    logInfo("gateway.bootstrap.instructions_loaded");

    // 2. Initialize tools
    initializeTools();

    // 3. Ensure default tenant/workspace exists for runtime compatibility.
    const { tenantRepo } = await import("../lib/db/tenantRepo");
    await tenantRepo.ensureDefaultTenant();

    const { channelRepo } = await import("../lib/db/channelRepo");
    const activeChannels = await channelRepo.listActiveRuntimeChannels();

    ensureProcessorRefsInitialized();
    const inboundProcessor = inboundProcessorRef as (job: Job<InboundMessageJob>) => Promise<void>;
    const outboundProcessor = outboundProcessorRef as (job: Job<OutboundSendJob>) => Promise<void>;

    // 4. Start queue workers
    startWorker(inboundProcessor);

    for (const channel of activeChannels) {
        startInboundWorkerForPartition(channel.workspaceId, channel.id, inboundProcessor);
        startOutboundWorkerForPartition(channel.workspaceId, channel.id, outboundProcessor);
    }

    // 5. Connect to WhatsApp (all active channels)
    await connectToWhatsApp();
    startMemoryRetentionScheduler();
    campaignService.startScheduler();
    webhookService.startDispatcher();

    logInfo("gateway.bootstrap.ready", {
        activeChannelCount: activeChannels.length,
    });
}
