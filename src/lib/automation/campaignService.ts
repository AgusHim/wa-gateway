import { CampaignRecipientStatus, CampaignStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { channelRepo } from "@/lib/db/channelRepo";
import { getOutboundSendQueue } from "@/lib/queue/messageQueue";
import { assertTenantScope } from "@/lib/tenant/context";

export type CampaignSegmentFilter = {
    label?: string;
    segment?: string;
    lastActiveWithinDays?: number;
    memoryKey?: string;
    memoryValueContains?: string;
    includeBlocked?: boolean;
};

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerInFlight = false;

function normalizeSegmentFilter(filter: CampaignSegmentFilter | undefined): CampaignSegmentFilter {
    return {
        label: filter?.label?.trim() || undefined,
        segment: filter?.segment?.trim() || undefined,
        lastActiveWithinDays: typeof filter?.lastActiveWithinDays === "number"
            ? Math.max(1, Math.min(3650, Math.round(filter.lastActiveWithinDays)))
            : undefined,
        memoryKey: filter?.memoryKey?.trim() || undefined,
        memoryValueContains: filter?.memoryValueContains?.trim() || undefined,
        includeBlocked: filter?.includeBlocked === true,
    };
}

function buildUserSegmentWhere(workspaceId: string, filter: CampaignSegmentFilter): Prisma.ChatUserWhereInput {
    const where: Prisma.ChatUserWhereInput = {
        workspaceId,
    };

    if (!filter.includeBlocked) {
        where.isBlocked = false;
    }

    if (filter.label) {
        where.label = filter.label;
    }

    if (filter.segment) {
        where.segments = {
            has: filter.segment,
        };
    }

    if (filter.lastActiveWithinDays) {
        const since = new Date(Date.now() - filter.lastActiveWithinDays * 24 * 60 * 60 * 1000);
        where.updatedAt = { gte: since };
    }

    if (filter.memoryKey || filter.memoryValueContains) {
        where.memories = {
            some: {
                key: filter.memoryKey,
                value: filter.memoryValueContains
                    ? { contains: filter.memoryValueContains, mode: "insensitive" }
                    : undefined,
            },
        };
    }

    return where;
}

function renderMessageTemplate(template: string, user: { name: string | null; phoneNumber: string }): string {
    return template
        .replace(/\{\{\s*name\s*\}\}/gi, user.name || "Kak")
        .replace(/\{\{\s*phone\s*\}\}/gi, user.phoneNumber);
}

function conversionProxyMatch(message: string): boolean {
    const normalized = message.toLowerCase();
    const keywords = [
        "deal",
        "checkout",
        "bayar",
        "pembayaran",
        "paid",
        "ok ambil",
        "jadi beli",
        "register",
        "daftar",
    ];

    return keywords.some((keyword) => normalized.includes(keyword));
}

async function finalizeCampaignIfDone(campaignId: string) {
    const remaining = await prisma.campaignRecipient.count({
        where: {
            campaignId,
            status: { in: [CampaignRecipientStatus.PENDING, CampaignRecipientStatus.QUEUED] },
        },
    });

    if (remaining > 0) {
        return;
    }

    const sentCount = await prisma.campaignRecipient.count({
        where: {
            campaignId,
            status: {
                in: [
                    CampaignRecipientStatus.SENT,
                    CampaignRecipientStatus.REPLIED,
                    CampaignRecipientStatus.CONVERTED,
                ],
            },
        },
    });

    await prisma.campaign.update({
        where: { id: campaignId },
        data: {
            status: sentCount > 0 ? CampaignStatus.COMPLETED : CampaignStatus.FAILED,
            completedAt: new Date(),
        },
    });
}

export const campaignService = {
    async previewSegmentUsers(workspaceId: string, filter?: CampaignSegmentFilter, limit: number = 500) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const normalizedFilter = normalizeSegmentFilter(filter);

        return prisma.chatUser.findMany({
            where: buildUserSegmentWhere(resolvedWorkspaceId, normalizedFilter),
            orderBy: [{ updatedAt: "desc" }],
            take: Math.max(1, Math.min(5000, Math.round(limit))),
            select: {
                id: true,
                phoneNumber: true,
                name: true,
                label: true,
                segments: true,
                updatedAt: true,
            },
        });
    },

    async createCampaign(input: {
        workspaceId: string;
        name: string;
        messageTemplate: string;
        segment?: CampaignSegmentFilter;
        scheduledAt?: Date | null;
        throttlePerSecond?: number;
    }) {
        const workspaceId = assertTenantScope(input.workspaceId);
        const segment = normalizeSegmentFilter(input.segment);
        const audience = await this.previewSegmentUsers(workspaceId, segment, 5000);
        const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;

        const now = new Date();
        const isScheduled = Boolean(scheduledAt && scheduledAt.getTime() > now.getTime());
        const initialStatus = isScheduled ? CampaignStatus.SCHEDULED : CampaignStatus.RUNNING;

        const campaign = await prisma.campaign.create({
            data: {
                workspaceId,
                name: input.name.trim() || `Campaign ${now.toISOString()}`,
                messageTemplate: input.messageTemplate,
                segment: segment as Prisma.InputJsonValue,
                status: initialStatus,
                scheduledAt,
                startedAt: isScheduled ? null : now,
                throttlePerSecond: Number.isFinite(input.throttlePerSecond)
                    ? Math.max(1, Math.min(100, Math.round(input.throttlePerSecond as number)))
                    : 5,
                recipients: {
                    create: audience.map((user) => ({
                        workspaceId,
                        userId: user.id,
                        phoneNumber: user.phoneNumber,
                        status: CampaignRecipientStatus.PENDING,
                        metadata: {
                            name: user.name,
                            label: user.label,
                            segments: user.segments,
                        } as Prisma.InputJsonValue,
                    })),
                },
            },
            include: {
                _count: { select: { recipients: true } },
            },
        });

        if (!isScheduled) {
            await this.dispatchCampaign(campaign.id);
        }

        return campaign;
    },

    async listCampaigns(workspaceId: string, limit: number = 50) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.campaign.findMany({
            where: { workspaceId: resolvedWorkspaceId },
            orderBy: [{ createdAt: "desc" }],
            take: Math.max(1, Math.min(500, Math.round(limit))),
            include: {
                _count: { select: { recipients: true } },
            },
        });
    },

    async getCampaignById(workspaceId: string, campaignId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.campaign.findFirst({
            where: {
                id: campaignId,
                workspaceId: resolvedWorkspaceId,
            },
            include: {
                recipients: {
                    orderBy: [{ createdAt: "asc" }],
                    take: 1000,
                },
            },
        });
    },

    async getCampaignSummary(workspaceId: string, campaignId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const grouped = await prisma.campaignRecipient.groupBy({
            by: ["status"],
            where: {
                workspaceId: resolvedWorkspaceId,
                campaignId,
            },
            _count: {
                status: true,
            },
        });

        const totals = {
            total: 0,
            delivered: 0,
            replied: 0,
            converted: 0,
            failed: 0,
        };

        for (const item of grouped) {
            const count = item._count.status;
            totals.total += count;

            if (item.status === CampaignRecipientStatus.SENT) {
                totals.delivered += count;
            }
            if (item.status === CampaignRecipientStatus.REPLIED) {
                totals.replied += count;
                totals.delivered += count;
            }
            if (item.status === CampaignRecipientStatus.CONVERTED) {
                totals.converted += count;
                totals.replied += count;
                totals.delivered += count;
            }
            if (item.status === CampaignRecipientStatus.FAILED) {
                totals.failed += count;
            }
        }

        const replyRate = totals.delivered > 0 ? totals.replied / totals.delivered : 0;
        const conversionRate = totals.replied > 0 ? totals.converted / totals.replied : 0;

        return {
            ...totals,
            replyRate,
            conversionRate,
        };
    },

    async dispatchCampaign(campaignId: string) {
        const campaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            include: {
                recipients: {
                    where: {
                        status: CampaignRecipientStatus.PENDING,
                    },
                    orderBy: [{ createdAt: "asc" }],
                },
            },
        });

        if (!campaign) {
            throw new Error("Campaign not found");
        }

        if (campaign.status === CampaignStatus.CANCELED || campaign.status === CampaignStatus.COMPLETED) {
            return { queued: 0, campaignId: campaign.id };
        }

        if (campaign.recipients.length === 0) {
            await finalizeCampaignIfDone(campaign.id);
            return { queued: 0, campaignId: campaign.id };
        }

        const primaryChannel = await channelRepo.getPrimaryWorkspaceChannel(campaign.workspaceId);
        if (!primaryChannel) {
            throw new Error(`No active channel for workspace=${campaign.workspaceId}`);
        }

        const queue = getOutboundSendQueue(campaign.workspaceId, primaryChannel.id);
        const delayStep = Math.ceil(1000 / Math.max(1, campaign.throttlePerSecond));

        let queued = 0;
        for (const [index, recipient] of campaign.recipients.entries()) {
            const personalization = recipient.metadata && typeof recipient.metadata === "object" && !Array.isArray(recipient.metadata)
                ? recipient.metadata as Record<string, unknown>
                : {};
            const text = renderMessageTemplate(campaign.messageTemplate, {
                name: typeof personalization.name === "string" ? personalization.name : null,
                phoneNumber: recipient.phoneNumber,
            });

            await queue.add(`campaign:${campaign.id}:${recipient.id}`, {
                workspaceId: campaign.workspaceId,
                channelId: primaryChannel.id,
                phoneNumber: recipient.phoneNumber,
                text,
                mode: "broadcast",
                requestedAt: Date.now(),
                campaignId: campaign.id,
                campaignRecipientId: recipient.id,
            }, {
                delay: index * delayStep,
            });

            queued += 1;
        }

        await prisma.$transaction([
            prisma.campaign.update({
                where: { id: campaign.id },
                data: {
                    status: CampaignStatus.RUNNING,
                    startedAt: campaign.startedAt ?? new Date(),
                },
            }),
            prisma.campaignRecipient.updateMany({
                where: {
                    campaignId: campaign.id,
                    status: CampaignRecipientStatus.PENDING,
                },
                data: {
                    status: CampaignRecipientStatus.QUEUED,
                    queuedAt: new Date(),
                },
            }),
        ]);

        return {
            campaignId: campaign.id,
            queued,
        };
    },

    async processDueCampaigns() {
        const now = new Date();
        const due = await prisma.campaign.findMany({
            where: {
                status: CampaignStatus.SCHEDULED,
                scheduledAt: { lte: now },
            },
            orderBy: [{ scheduledAt: "asc" }],
            take: 50,
            select: { id: true },
        });

        for (const campaign of due) {
            try {
                await this.dispatchCampaign(campaign.id);
            } catch (error) {
                console.error(`[Campaign] Failed to dispatch campaign ${campaign.id}:`, error);
                await prisma.campaign.update({
                    where: { id: campaign.id },
                    data: {
                        status: CampaignStatus.FAILED,
                    },
                });
            }
        }

        return due.length;
    },

    startScheduler(intervalMs: number = 30_000) {
        if (schedulerTimer) {
            return;
        }

        const run = () => {
            if (schedulerInFlight) {
                return;
            }

            schedulerInFlight = true;
            this.processDueCampaigns()
                .catch((error) => {
                    console.error("[Campaign] Scheduler failed:", error);
                })
                .finally(() => {
                    schedulerInFlight = false;
                });
        };

        run();
        schedulerTimer = setInterval(run, Math.max(10_000, intervalMs));
    },

    async markRecipientSent(campaignRecipientId: string) {
        const recipient = await prisma.campaignRecipient.update({
            where: { id: campaignRecipientId },
            data: {
                status: CampaignRecipientStatus.SENT,
                sentAt: new Date(),
                lastError: null,
            },
            select: {
                campaignId: true,
            },
        });

        await finalizeCampaignIfDone(recipient.campaignId);
    },

    async markRecipientFailed(campaignRecipientId: string, errorMessage: string) {
        const recipient = await prisma.campaignRecipient.update({
            where: { id: campaignRecipientId },
            data: {
                status: CampaignRecipientStatus.FAILED,
                lastError: errorMessage.slice(0, 1000),
            },
            select: {
                campaignId: true,
            },
        });

        await finalizeCampaignIfDone(recipient.campaignId);
    },

    async recordInboundReply(workspaceId: string, phoneNumber: string, latestMessage?: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);

        const recipient = await prisma.campaignRecipient.findFirst({
            where: {
                workspaceId: resolvedWorkspaceId,
                phoneNumber,
                status: CampaignRecipientStatus.SENT,
            },
            orderBy: [{ sentAt: "desc" }],
        });

        if (!recipient) {
            return null;
        }

        const converted = latestMessage ? conversionProxyMatch(latestMessage) : false;
        await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status: converted ? CampaignRecipientStatus.CONVERTED : CampaignRecipientStatus.REPLIED,
                repliedAt: new Date(),
                convertedAt: converted ? new Date() : null,
            },
        });

        await finalizeCampaignIfDone(recipient.campaignId);

        return {
            campaignId: recipient.campaignId,
            recipientId: recipient.id,
            converted,
        };
    },

    async getCampaignAnalytics(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);

        const grouped = await prisma.campaignRecipient.groupBy({
            by: ["status"],
            where: {
                workspaceId: resolvedWorkspaceId,
            },
            _count: {
                status: true,
            },
        });

        const totals = {
            total: 0,
            delivered: 0,
            replied: 0,
            converted: 0,
            failed: 0,
        };

        for (const item of grouped) {
            const count = item._count.status;
            totals.total += count;

            if (item.status === CampaignRecipientStatus.SENT) {
                totals.delivered += count;
            }
            if (item.status === CampaignRecipientStatus.REPLIED) {
                totals.replied += count;
                totals.delivered += count;
            }
            if (item.status === CampaignRecipientStatus.CONVERTED) {
                totals.converted += count;
                totals.replied += count;
                totals.delivered += count;
            }
            if (item.status === CampaignRecipientStatus.FAILED) {
                totals.failed += count;
            }
        }

        const replyRate = totals.delivered > 0 ? totals.replied / totals.delivered : 0;
        const conversionRate = totals.replied > 0 ? totals.converted / totals.replied : 0;

        return {
            ...totals,
            replyRate,
            conversionRate,
        };
    },
};
