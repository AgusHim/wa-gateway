import { HandoverTicketStatus } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { channelRepo } from "@/lib/db/channelRepo";
import { instagramChannelRepo } from "@/lib/integrations/instagram/channelRepo";
import { instagramRepo } from "@/lib/integrations/instagram/repo";
import { getWorkspaceInstagramAutoReplyRules } from "@/lib/integrations/instagram/ruleConfig";
import { assertTenantScope } from "@/lib/tenant/context";
import { isInstagramScopedUserIdentifier, resolveInstagramRetentionPolicy } from "./privacyPolicy";

function asRecord(value: unknown): Record<string, unknown> {
    return (value && typeof value === "object" && !Array.isArray(value))
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(1, Math.min(max, Math.round(value as number)));
}

export async function getInstagramChannelIncidentSnapshot(input: {
    workspaceId: string;
    channelId: string;
    auditLimit?: number;
    messageLimit?: number;
}) {
    const workspaceId = assertTenantScope(input.workspaceId);
    const channelId = input.channelId.trim();
    if (!channelId) {
        throw new Error("channelId is required");
    }

    const channel = await channelRepo.getWorkspaceChannel(workspaceId, channelId);
    if (!channel || channel.provider !== "instagram") {
        throw new Error("Instagram channel not found in workspace");
    }

    const auditLimit = clampLimit(input.auditLimit, 30, 100);
    const messageLimit = clampLimit(input.messageLimit, 30, 100);

    const [binding, config, rules, audits, messages] = await Promise.all([
        instagramRepo.getChannelBinding(workspaceId, channelId),
        instagramChannelRepo.getWorkspaceChannelConfig(workspaceId, channelId),
        getWorkspaceInstagramAutoReplyRules(workspaceId),
        channelRepo.getRecentAudits(channelId, auditLimit),
        prisma.message.findMany({
            where: {
                workspaceId,
                AND: [
                    {
                        metadata: {
                            path: ["channelId"],
                            equals: channelId,
                        },
                    },
                    {
                        OR: [
                            {
                                metadata: {
                                    path: ["provider"],
                                    equals: "instagram",
                                },
                            },
                            {
                                metadata: {
                                    path: ["source"],
                                    equals: "instagram",
                                },
                            },
                            {
                                metadata: {
                                    path: ["source"],
                                    equals: "instagram-thread-control",
                                },
                            },
                        ],
                    },
                ],
            },
            orderBy: { createdAt: "desc" },
            take: messageLimit,
            select: {
                id: true,
                role: true,
                content: true,
                metadata: true,
                createdAt: true,
                user: {
                    select: {
                        id: true,
                        name: true,
                        phoneNumber: true,
                    },
                },
            },
        }),
    ]);

    const formattedMessages = messages.map((message) => {
        const metadata = asRecord(message.metadata);
        const outbound = asRecord(metadata.outboundInstagram);
        return {
            id: message.id,
            role: message.role,
            contentPreview: message.content.slice(0, 280),
            createdAt: message.createdAt.toISOString(),
            user: {
                id: message.user.id,
                name: message.user.name,
                identifier: message.user.phoneNumber,
            },
            eventType: readString(metadata.eventType) || readString(metadata.source),
            threadId: readString(metadata.threadId) || null,
            commentId: readString(metadata.commentId) || null,
            mediaId: readString(metadata.mediaId) || null,
            igUserId: readString(metadata.igUserId) || null,
            skippedReason: readString(metadata.autoReplySkippedReason) || null,
            outboundStatus: readString(outbound.status) || null,
            outboundReasonCode: readString(outbound.reasonCode) || null,
        };
    });

    const recentInstagramIdentifiers = Array.from(new Set(messages
        .map((message) => message.user.phoneNumber)
        .filter((value) => isInstagramScopedUserIdentifier(value))));

    const openHandoverTickets = recentInstagramIdentifiers.length > 0
        ? await prisma.handoverTicket.findMany({
            where: {
                workspaceId,
                status: HandoverTicketStatus.OPEN,
                phoneNumber: {
                    in: recentInstagramIdentifiers,
                },
            },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: {
                id: true,
                userId: true,
                phoneNumber: true,
                topic: true,
                keyword: true,
                triggeredBy: true,
                priority: true,
                createdAt: true,
                slaDueAt: true,
            },
        })
        : [];

    const formattedAudits = audits.map((audit) => ({
        id: audit.id,
        eventType: audit.eventType,
        status: audit.status,
        message: audit.message,
        metadata: audit.metadata,
        createdAt: audit.createdAt.toISOString(),
    }));

    return {
        channel: {
            id: channel.id,
            name: channel.name,
            status: channel.status,
            isEnabled: channel.isEnabled,
            healthStatus: channel.healthStatus,
            healthScore: channel.healthScore,
            lastError: channel.lastError,
            lastSeenAt: channel.lastSeenAt?.toISOString() || null,
        },
        binding,
        config: config
            ? {
                pageId: config.pageId,
                pageName: config.pageName,
                instagramAccountId: config.instagramAccountId,
                instagramUsername: config.instagramUsername,
                tokenStatus: config.tokenStatus,
                tokenExpiresAt: config.tokenExpiresAt?.toISOString() || null,
                tokenLastRefreshAt: config.tokenLastRefreshAt?.toISOString() || null,
                webhookSubscribedAt: config.webhookSubscribedAt?.toISOString() || null,
                lastWebhookAt: config.lastWebhookAt?.toISOString() || null,
            }
            : null,
        autoReplyRules: rules,
        retentionPolicy: resolveInstagramRetentionPolicy(),
        audits: formattedAudits,
        recentMessages: formattedMessages,
        skippedMessages: formattedMessages.filter((message) => Boolean(message.skippedReason)),
        openHandoverTickets: openHandoverTickets.map((ticket) => ({
            id: ticket.id,
            userId: ticket.userId,
            identifier: ticket.phoneNumber,
            topic: ticket.topic,
            keyword: ticket.keyword,
            triggeredBy: ticket.triggeredBy,
            priority: ticket.priority,
            createdAt: ticket.createdAt.toISOString(),
            slaDueAt: ticket.slaDueAt.toISOString(),
        })),
        summary: {
            recentAuditErrors: formattedAudits.filter((audit) => audit.status === "error").length,
            recentSkippedMessages: formattedMessages.filter((message) => Boolean(message.skippedReason)).length,
            recentOutboundFailures: formattedMessages.filter((message) => message.outboundStatus === "failed").length,
            openHandoverCount: openHandoverTickets.length,
        },
    };
}
