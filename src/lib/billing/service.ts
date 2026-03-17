import crypto from "crypto";
import {
    BillingCycle,
    InvoiceStatus,
    PaymentEventStatus,
    PaymentProvider,
    PlanCode,
    Prisma,
    SubscriptionStatus,
    UsageMetric,
} from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { assertTenantScope } from "@/lib/tenant/context";

type PlanTemplate = {
    code: PlanCode;
    name: string;
    description: string;
    monthlyPriceCents: number;
    yearlyPriceCents: number;
    messageLimit: number;
    aiTokenLimit: number;
    channelLimit: number;
    seatLimit: number;
    toolLimit: number;
    softLimitRatio: number;
};

type UsageCheckResult = {
    allowed: boolean;
    softLimitReached: boolean;
    hardLimitReached: boolean;
    used: number;
    projected: number;
    limit: number;
    metric: UsageMetric;
};

type UsageConsumeInput = {
    workspaceId: string;
    metric: UsageMetric;
    quantity: number;
    channelId?: string;
    referenceId?: string;
    metadata?: Record<string, unknown>;
};

type BillingSnapshot = {
    organizationId: string;
    workspaceId: string;
    subscription: {
        id: string;
        status: SubscriptionStatus;
        billingCycle: BillingCycle;
        currentPeriodStart: Date;
        currentPeriodEnd: Date;
        trialEndAt: Date | null;
        graceUntil: Date | null;
        cancelAtPeriodEnd: boolean;
        canceledAt: Date | null;
        plan: {
            code: PlanCode;
            name: string;
            currency: string;
            monthlyPriceCents: number;
            yearlyPriceCents: number | null;
            messageLimit: number;
            aiTokenLimit: number;
            channelLimit: number;
            seatLimit: number;
            toolLimit: number;
            softLimitRatio: number;
        };
    };
    plans: Array<{
        code: PlanCode;
        name: string;
        description: string | null;
        currency: string;
        monthlyPriceCents: number;
        yearlyPriceCents: number | null;
        messageLimit: number;
        aiTokenLimit: number;
        channelLimit: number;
        seatLimit: number;
        toolLimit: number;
        softLimitRatio: number;
    }>;
    usage: {
        month: string;
        messages: { used: number; limit: number; softLimitReached: boolean; hardLimitReached: boolean };
        instagramInbound: { used: number; limit: number; softLimitReached: boolean; hardLimitReached: boolean };
        instagramOutbound: { used: number; limit: number; softLimitReached: boolean; hardLimitReached: boolean };
        instagramCommentReplies: { used: number; limit: number; softLimitReached: boolean; hardLimitReached: boolean };
        aiTokens: { used: number; limit: number; softLimitReached: boolean; hardLimitReached: boolean };
        toolCalls: { used: number; limit: number; softLimitReached: boolean; hardLimitReached: boolean };
        channels: { used: number; limit: number; softLimitReached: boolean; hardLimitReached: boolean };
        seats: { used: number; limit: number; softLimitReached: boolean; hardLimitReached: boolean };
    };
    invoices: Array<{
        id: string;
        invoiceNumber: string;
        status: InvoiceStatus;
        currency: string;
        amountTotalCents: number;
        periodStart: Date;
        periodEnd: Date;
        dueAt: Date | null;
        paidAt: Date | null;
        createdAt: Date;
    }>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const PLAN_TEMPLATES: PlanTemplate[] = [
    {
        code: PlanCode.FREE,
        name: "Free",
        description: "Plan gratis untuk coba produk",
        monthlyPriceCents: 0,
        yearlyPriceCents: 0,
        messageLimit: 1000,
        aiTokenLimit: 250000,
        channelLimit: 1,
        seatLimit: 2,
        toolLimit: 200,
        softLimitRatio: 0.8,
    },
    {
        code: PlanCode.PRO,
        name: "Pro",
        description: "Plan profesional untuk tim kecil-menengah",
        monthlyPriceCents: 4900,
        yearlyPriceCents: 49000,
        messageLimit: 25000,
        aiTokenLimit: 5000000,
        channelLimit: 5,
        seatLimit: 10,
        toolLimit: 5000,
        softLimitRatio: 0.85,
    },
    {
        code: PlanCode.SCALE,
        name: "Scale",
        description: "Plan high-volume untuk multi-team",
        monthlyPriceCents: 14900,
        yearlyPriceCents: 149000,
        messageLimit: 150000,
        aiTokenLimit: 35000000,
        channelLimit: 20,
        seatLimit: 40,
        toolLimit: 50000,
        softLimitRatio: 0.9,
    },
    {
        code: PlanCode.ENTERPRISE,
        name: "Enterprise",
        description: "Plan enterprise dengan kapasitas besar",
        monthlyPriceCents: 49900,
        yearlyPriceCents: 499000,
        messageLimit: 1000000,
        aiTokenLimit: 250000000,
        channelLimit: 100,
        seatLimit: 200,
        toolLimit: 250000,
        softLimitRatio: 0.9,
    },
];

function startOfDay(date: Date): Date {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    return value;
}

function startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * DAY_MS);
}

function addMonths(date: Date, months: number): Date {
    const value = new Date(date);
    value.setMonth(value.getMonth() + months);
    return value;
}

function addYears(date: Date, years: number): Date {
    const value = new Date(date);
    value.setFullYear(value.getFullYear() + years);
    return value;
}

function getCyclePeriodEnd(start: Date, cycle: BillingCycle): Date {
    return cycle === BillingCycle.YEARLY ? addYears(start, 1) : addMonths(start, 1);
}

function isEnforcementEnabled() {
    return process.env.BILLING_ENFORCEMENT_ENABLED !== "false";
}

function computeThreshold(limit: number, ratio: number): number {
    if (limit <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(1, Math.floor(limit * ratio));
}

function createInvoiceNumber(organizationId: string) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
    return `INV-${date}-${organizationId.slice(0, 6).toUpperCase()}-${suffix}`;
}

function readPayloadString(payload: Prisma.JsonValue | null | undefined, key: string): string | null {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return null;
    }

    const value = (payload as Record<string, unknown>)[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPayloadDate(payload: Prisma.JsonValue | null | undefined, key: string): Date | null {
    const value = readPayloadString(payload, key);
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

async function ensurePlanCatalogExists() {
    for (const plan of PLAN_TEMPLATES) {
        const existing = await prisma.plan.findUnique({ where: { code: plan.code }, select: { id: true } });
        if (existing) {
            continue;
        }

        await prisma.plan.create({
            data: {
                code: plan.code,
                name: plan.name,
                description: plan.description,
                monthlyPriceCents: plan.monthlyPriceCents,
                yearlyPriceCents: plan.yearlyPriceCents,
                messageLimit: plan.messageLimit,
                aiTokenLimit: plan.aiTokenLimit,
                channelLimit: plan.channelLimit,
                seatLimit: plan.seatLimit,
                toolLimit: plan.toolLimit,
                softLimitRatio: plan.softLimitRatio,
                isActive: true,
            },
        });
    }
}

async function ensureBillingProfile(organizationId: string) {
    await prisma.billingProfile.upsert({
        where: { organizationId },
        update: {},
        create: {
            organizationId,
            provider: PaymentProvider.MANUAL,
        },
    });
}

async function resolveWorkspaceBillingContext(workspaceId: string) {
    const resolvedWorkspaceId = assertTenantScope(workspaceId);

    const workspace = await prisma.workspace.findUnique({
        where: { id: resolvedWorkspaceId },
        select: {
            id: true,
            organizationId: true,
        },
    });

    if (!workspace) {
        throw new Error("Workspace not found");
    }

    return workspace;
}

async function refreshSubscriptionState(subscriptionId: string) {
    const now = new Date();

    const subscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: {
            plan: true,
        },
    });

    if (!subscription) {
        throw new Error("Subscription not found");
    }

    const updates: Prisma.SubscriptionUpdateInput = {};

    if (subscription.status === SubscriptionStatus.PAST_DUE && subscription.graceUntil && subscription.graceUntil <= now) {
        updates.status = SubscriptionStatus.EXPIRED;
        updates.endedAt = now;
    }

    if (
        subscription.cancelAtPeriodEnd
        && subscription.currentPeriodEnd <= now
        && subscription.status !== SubscriptionStatus.CANCELED
        && subscription.status !== SubscriptionStatus.EXPIRED
    ) {
        updates.status = SubscriptionStatus.CANCELED;
        updates.endedAt = now;
    }

    if (
        subscription.status === SubscriptionStatus.TRIALING
        && subscription.trialEndAt
        && subscription.trialEndAt <= now
    ) {
        updates.status = SubscriptionStatus.ACTIVE;
        updates.trialEndAt = null;
    }

    if (
        !subscription.cancelAtPeriodEnd
        && subscription.status !== SubscriptionStatus.CANCELED
        && subscription.status !== SubscriptionStatus.EXPIRED
        && subscription.currentPeriodEnd <= now
    ) {
        const nextStart = subscription.currentPeriodEnd;
        const nextEnd = getCyclePeriodEnd(nextStart, subscription.billingCycle);
        updates.currentPeriodStart = nextStart;
        updates.currentPeriodEnd = nextEnd;
    }

    if (Object.keys(updates).length === 0) {
        return subscription;
    }

    return prisma.subscription.update({
        where: { id: subscription.id },
        data: updates,
        include: {
            plan: true,
        },
    });
}

async function createSubscriptionInvoice(subscriptionId: string) {
    const subscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: { plan: true },
    });

    if (!subscription) {
        throw new Error("Subscription not found");
    }

    const amountSubtotalCents = subscription.billingCycle === BillingCycle.YEARLY
        ? subscription.plan.yearlyPriceCents ?? subscription.plan.monthlyPriceCents * 12
        : subscription.plan.monthlyPriceCents;

    return prisma.invoice.create({
        data: {
            organizationId: subscription.organizationId,
            subscriptionId: subscription.id,
            invoiceNumber: createInvoiceNumber(subscription.organizationId),
            status: InvoiceStatus.OPEN,
            currency: subscription.plan.currency,
            amountSubtotalCents,
            amountTaxCents: 0,
            amountTotalCents: amountSubtotalCents,
            periodStart: subscription.currentPeriodStart,
            periodEnd: subscription.currentPeriodEnd,
            dueAt: addDays(new Date(), 7),
        },
    });
}

async function getCurrentSubscription(organizationId: string) {
    const subscription = await prisma.subscription.findFirst({
        where: {
            organizationId,
            endedAt: null,
        },
        orderBy: { createdAt: "desc" },
        include: { plan: true },
    });

    if (!subscription) {
        return null;
    }

    return refreshSubscriptionState(subscription.id);
}

async function ensureOrganizationSubscription(organizationId: string) {
    await ensurePlanCatalogExists();
    await ensureBillingProfile(organizationId);

    const current = await getCurrentSubscription(organizationId);
    if (current) {
        return current;
    }

    const freePlan = await prisma.plan.findUnique({
        where: { code: PlanCode.FREE },
    });

    if (!freePlan) {
        throw new Error("Free plan is not configured");
    }

    const now = new Date();
    const currentPeriodEnd = getCyclePeriodEnd(now, BillingCycle.MONTHLY);

    return prisma.subscription.create({
        data: {
            organizationId,
            planId: freePlan.id,
            status: SubscriptionStatus.TRIALING,
            provider: PaymentProvider.MANUAL,
            billingCycle: BillingCycle.MONTHLY,
            currentPeriodStart: now,
            currentPeriodEnd,
            trialEndAt: addDays(now, 14),
            graceUntil: null,
            cancelAtPeriodEnd: false,
        },
        include: { plan: true },
    });
}

async function loadMonthlyUsage(workspaceId: string, month: Date) {
    const rows = await prisma.usageMonthlyAggregate.findMany({
        where: {
            workspaceId,
            month,
        },
        select: {
            metric: true,
            quantity: true,
        },
    });

    const usage = new Map<UsageMetric, number>();
    for (const row of rows) {
        usage.set(row.metric, row.quantity);
    }

    return usage;
}

function getMetricLimit(subscriptionPlan: {
    messageLimit: number;
    aiTokenLimit: number;
    toolLimit: number;
}, metric: UsageMetric): number {
    if (metric === UsageMetric.AI_TOKEN) return subscriptionPlan.aiTokenLimit;
    if (metric === UsageMetric.TOOL_CALL) return subscriptionPlan.toolLimit;
    return subscriptionPlan.messageLimit;
}

function getTotalMessageUsage(usage: Map<UsageMetric, number>): number {
    return (usage.get(UsageMetric.INBOUND_MESSAGE) ?? 0)
        + (usage.get(UsageMetric.OUTBOUND_MESSAGE) ?? 0)
        + (usage.get(UsageMetric.MEDIA_IN) ?? 0)
        + (usage.get(UsageMetric.MEDIA_OUT) ?? 0)
        + (usage.get(UsageMetric.IG_INBOUND) ?? 0)
        + (usage.get(UsageMetric.IG_OUTBOUND) ?? 0)
        + (usage.get(UsageMetric.IG_COMMENT_REPLY) ?? 0);
}

function getUsageForMetric(usage: Map<UsageMetric, number>, metric: UsageMetric): number {
    if (
        metric === UsageMetric.INBOUND_MESSAGE
        || metric === UsageMetric.OUTBOUND_MESSAGE
        || metric === UsageMetric.MEDIA_IN
        || metric === UsageMetric.MEDIA_OUT
        || metric === UsageMetric.IG_INBOUND
        || metric === UsageMetric.IG_OUTBOUND
        || metric === UsageMetric.IG_COMMENT_REPLY
    ) {
        return getTotalMessageUsage(usage);
    }

    return usage.get(metric) ?? 0;
}

async function evaluateUsageLimit(workspaceId: string, metric: UsageMetric, quantity: number): Promise<UsageCheckResult> {
    const context = await resolveWorkspaceBillingContext(workspaceId);
    const subscription = await ensureOrganizationSubscription(context.organizationId);
    const month = startOfMonth(new Date());
    const usage = await loadMonthlyUsage(workspaceId, month);

    const used = getUsageForMetric(usage, metric);
    const limit = getMetricLimit(subscription.plan, metric);
    const projected = used + quantity;
    const threshold = computeThreshold(limit, subscription.plan.softLimitRatio);
    const hardLimitReached = limit > 0 && projected > limit;
    const softLimitReached = limit > 0 && projected >= threshold;

    return {
        allowed: !hardLimitReached,
        softLimitReached,
        hardLimitReached,
        used,
        projected,
        limit,
        metric,
    };
}

async function recordUsageEvent(input: UsageConsumeInput) {
    const resolvedWorkspaceId = assertTenantScope(input.workspaceId);
    const quantity = Number.isFinite(input.quantity) ? Math.max(0, Math.trunc(input.quantity)) : 0;

    if (quantity <= 0) {
        return null;
    }

    const context = await resolveWorkspaceBillingContext(resolvedWorkspaceId);
    const now = new Date();
    const day = startOfDay(now);
    const month = startOfMonth(now);

    return prisma.$transaction(async (tx) => {
        const event = await tx.usageEvent.create({
            data: {
                organizationId: context.organizationId,
                workspaceId: resolvedWorkspaceId,
                channelId: input.channelId,
                metric: input.metric,
                quantity,
                referenceId: input.referenceId,
                metadata: (input.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
                occurredAt: now,
            },
        });

        await tx.usageDailyAggregate.upsert({
            where: {
                workspaceId_metric_date: {
                    workspaceId: resolvedWorkspaceId,
                    metric: input.metric,
                    date: day,
                },
            },
            update: {
                quantity: { increment: quantity },
            },
            create: {
                organizationId: context.organizationId,
                workspaceId: resolvedWorkspaceId,
                metric: input.metric,
                date: day,
                quantity,
            },
        });

        await tx.usageMonthlyAggregate.upsert({
            where: {
                workspaceId_metric_month: {
                    workspaceId: resolvedWorkspaceId,
                    metric: input.metric,
                    month,
                },
            },
            update: {
                quantity: { increment: quantity },
            },
            create: {
                organizationId: context.organizationId,
                workspaceId: resolvedWorkspaceId,
                metric: input.metric,
                month,
                quantity,
            },
        });

        return event;
    });
}

async function consumeUsage(input: UsageConsumeInput) {
    if (!isEnforcementEnabled()) {
        await recordUsageEvent(input);
        return {
            allowed: true,
            softLimitReached: false,
            hardLimitReached: false,
            used: 0,
            projected: input.quantity,
            limit: Number.MAX_SAFE_INTEGER,
            metric: input.metric,
        } satisfies UsageCheckResult;
    }

    const check = await evaluateUsageLimit(input.workspaceId, input.metric, input.quantity);
    if (!check.allowed) {
        return check;
    }

    await recordUsageEvent(input);
    return check;
}

async function listPlans() {
    await ensurePlanCatalogExists();
    return prisma.plan.findMany({
        where: { isActive: true },
        orderBy: { monthlyPriceCents: "asc" },
    });
}

async function changePlan(input: {
    organizationId: string;
    planCode: PlanCode;
    billingCycle: BillingCycle;
}) {
    await ensurePlanCatalogExists();

    const plan = await prisma.plan.findUnique({ where: { code: input.planCode } });
    if (!plan || !plan.isActive) {
        throw new Error("Plan not found or inactive");
    }

    const now = new Date();
    const periodEnd = getCyclePeriodEnd(now, input.billingCycle);
    const current = await getCurrentSubscription(input.organizationId);

    const subscription = current
        ? await prisma.subscription.update({
            where: { id: current.id },
            data: {
                planId: plan.id,
                status: SubscriptionStatus.ACTIVE,
                billingCycle: input.billingCycle,
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
                trialEndAt: null,
                graceUntil: null,
                cancelAtPeriodEnd: false,
                canceledAt: null,
                endedAt: null,
            },
            include: { plan: true },
        })
        : await prisma.subscription.create({
            data: {
                organizationId: input.organizationId,
                planId: plan.id,
                status: SubscriptionStatus.ACTIVE,
                billingCycle: input.billingCycle,
                provider: PaymentProvider.MANUAL,
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
                cancelAtPeriodEnd: false,
            },
            include: { plan: true },
        });

    await createSubscriptionInvoice(subscription.id);

    return subscription;
}

async function cancelSubscription(organizationId: string, immediate: boolean) {
    const current = await getCurrentSubscription(organizationId);
    if (!current) {
        throw new Error("Subscription not found");
    }

    const now = new Date();

    return prisma.subscription.update({
        where: { id: current.id },
        data: immediate
            ? {
                status: SubscriptionStatus.CANCELED,
                canceledAt: now,
                endedAt: now,
                cancelAtPeriodEnd: false,
                currentPeriodEnd: now,
            }
            : {
                canceledAt: now,
                cancelAtPeriodEnd: true,
            },
        include: { plan: true },
    });
}

async function markSubscriptionPastDue(subscriptionId: string, graceDays: number = 7) {
    const now = new Date();
    return prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
            status: SubscriptionStatus.PAST_DUE,
            graceUntil: addDays(now, graceDays),
        },
        include: { plan: true },
    });
}

async function getBillingSnapshot(workspaceId: string): Promise<BillingSnapshot> {
    const context = await resolveWorkspaceBillingContext(workspaceId);
    const subscription = await ensureOrganizationSubscription(context.organizationId);
    const plans = await listPlans();
    const month = startOfMonth(new Date());

    const [usageMap, invoices, seatCount, channelCount] = await Promise.all([
        loadMonthlyUsage(workspaceId, month),
        prisma.invoice.findMany({
            where: { organizationId: context.organizationId },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: {
                id: true,
                invoiceNumber: true,
                status: true,
                currency: true,
                amountTotalCents: true,
                periodStart: true,
                periodEnd: true,
                dueAt: true,
                paidAt: true,
                createdAt: true,
            },
        }),
        prisma.membership.count({ where: { organizationId: context.organizationId } }),
        prisma.channel.count({
            where: {
                workspace: {
                    organizationId: context.organizationId,
                },
            },
        }),
    ]);

    const totalMessagesUsed = getTotalMessageUsage(usageMap);
    const instagramInboundUsed = usageMap.get(UsageMetric.IG_INBOUND) ?? 0;
    const instagramOutboundUsed = usageMap.get(UsageMetric.IG_OUTBOUND) ?? 0;
    const instagramCommentRepliesUsed = usageMap.get(UsageMetric.IG_COMMENT_REPLY) ?? 0;
    const aiTokensUsed = usageMap.get(UsageMetric.AI_TOKEN) ?? 0;
    const toolCallsUsed = usageMap.get(UsageMetric.TOOL_CALL) ?? 0;

    const messageThreshold = computeThreshold(subscription.plan.messageLimit, subscription.plan.softLimitRatio);
    const tokenThreshold = computeThreshold(subscription.plan.aiTokenLimit, subscription.plan.softLimitRatio);
    const toolThreshold = computeThreshold(subscription.plan.toolLimit, subscription.plan.softLimitRatio);
    const channelThreshold = computeThreshold(subscription.plan.channelLimit, subscription.plan.softLimitRatio);
    const seatThreshold = computeThreshold(subscription.plan.seatLimit, subscription.plan.softLimitRatio);

    return {
        organizationId: context.organizationId,
        workspaceId,
        subscription: {
            id: subscription.id,
            status: subscription.status,
            billingCycle: subscription.billingCycle,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            trialEndAt: subscription.trialEndAt,
            graceUntil: subscription.graceUntil,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            canceledAt: subscription.canceledAt,
            plan: {
                code: subscription.plan.code,
                name: subscription.plan.name,
                currency: subscription.plan.currency,
                monthlyPriceCents: subscription.plan.monthlyPriceCents,
                yearlyPriceCents: subscription.plan.yearlyPriceCents,
                messageLimit: subscription.plan.messageLimit,
                aiTokenLimit: subscription.plan.aiTokenLimit,
                channelLimit: subscription.plan.channelLimit,
                seatLimit: subscription.plan.seatLimit,
                toolLimit: subscription.plan.toolLimit,
                softLimitRatio: subscription.plan.softLimitRatio,
            },
        },
        plans: plans.map((plan) => ({
            code: plan.code,
            name: plan.name,
            description: plan.description,
            currency: plan.currency,
            monthlyPriceCents: plan.monthlyPriceCents,
            yearlyPriceCents: plan.yearlyPriceCents,
            messageLimit: plan.messageLimit,
            aiTokenLimit: plan.aiTokenLimit,
            channelLimit: plan.channelLimit,
            seatLimit: plan.seatLimit,
            toolLimit: plan.toolLimit,
            softLimitRatio: plan.softLimitRatio,
        })),
        usage: {
            month: month.toISOString().slice(0, 7),
            messages: {
                used: totalMessagesUsed,
                limit: subscription.plan.messageLimit,
                softLimitReached: totalMessagesUsed >= messageThreshold,
                hardLimitReached: totalMessagesUsed > subscription.plan.messageLimit,
            },
            instagramInbound: {
                used: instagramInboundUsed,
                limit: subscription.plan.messageLimit,
                softLimitReached: instagramInboundUsed >= messageThreshold,
                hardLimitReached: instagramInboundUsed > subscription.plan.messageLimit,
            },
            instagramOutbound: {
                used: instagramOutboundUsed,
                limit: subscription.plan.messageLimit,
                softLimitReached: instagramOutboundUsed >= messageThreshold,
                hardLimitReached: instagramOutboundUsed > subscription.plan.messageLimit,
            },
            instagramCommentReplies: {
                used: instagramCommentRepliesUsed,
                limit: subscription.plan.messageLimit,
                softLimitReached: instagramCommentRepliesUsed >= messageThreshold,
                hardLimitReached: instagramCommentRepliesUsed > subscription.plan.messageLimit,
            },
            aiTokens: {
                used: aiTokensUsed,
                limit: subscription.plan.aiTokenLimit,
                softLimitReached: aiTokensUsed >= tokenThreshold,
                hardLimitReached: aiTokensUsed > subscription.plan.aiTokenLimit,
            },
            toolCalls: {
                used: toolCallsUsed,
                limit: subscription.plan.toolLimit,
                softLimitReached: toolCallsUsed >= toolThreshold,
                hardLimitReached: toolCallsUsed > subscription.plan.toolLimit,
            },
            channels: {
                used: channelCount,
                limit: subscription.plan.channelLimit,
                softLimitReached: channelCount >= channelThreshold,
                hardLimitReached: channelCount > subscription.plan.channelLimit,
            },
            seats: {
                used: seatCount,
                limit: subscription.plan.seatLimit,
                softLimitReached: seatCount >= seatThreshold,
                hardLimitReached: seatCount > subscription.plan.seatLimit,
            },
        },
        invoices,
    };
}

async function processPaymentEventById(paymentEventId: string) {
    const event = await prisma.paymentEvent.findUnique({ where: { id: paymentEventId } });
    if (!event) {
        throw new Error("Payment event not found");
    }

    try {
        if (event.eventType === "invoice.paid") {
            const invoiceIdFromPayload = readPayloadString(event.payload, "invoiceId");
            const invoice = event.invoiceId
                ? await prisma.invoice.findUnique({ where: { id: event.invoiceId } })
                : invoiceIdFromPayload
                    ? await prisma.invoice.findUnique({ where: { id: invoiceIdFromPayload } })
                    : null;

            if (invoice) {
                await prisma.invoice.update({
                    where: { id: invoice.id },
                    data: {
                        status: InvoiceStatus.PAID,
                        paidAt: new Date(),
                    },
                });

                if (invoice.subscriptionId) {
                    await prisma.subscription.update({
                        where: { id: invoice.subscriptionId },
                        data: {
                            status: SubscriptionStatus.ACTIVE,
                            graceUntil: null,
                        },
                    });
                }
            }
        } else if (event.eventType === "invoice.failed") {
            const invoiceIdFromPayload = readPayloadString(event.payload, "invoiceId");
            const invoice = event.invoiceId
                ? await prisma.invoice.findUnique({ where: { id: event.invoiceId } })
                : invoiceIdFromPayload
                    ? await prisma.invoice.findUnique({ where: { id: invoiceIdFromPayload } })
                    : null;

            if (invoice) {
                await prisma.invoice.update({
                    where: { id: invoice.id },
                    data: { status: InvoiceStatus.UNCOLLECTIBLE },
                });

                if (invoice.subscriptionId) {
                    await markSubscriptionPastDue(invoice.subscriptionId, 7);
                }
            }
        } else if (event.eventType === "subscription.canceled") {
            const subscriptionIdFromPayload = readPayloadString(event.payload, "subscriptionId");
            const subscriptionId = event.subscriptionId || subscriptionIdFromPayload;
            if (subscriptionId) {
                await cancelSubscription(event.organizationId, true);
            }
        } else if (
            event.eventType === "subscription.renewed"
            || event.eventType === "subscription.updated"
            || event.eventType === "subscription.activated"
        ) {
            const subscriptionIdFromPayload = readPayloadString(event.payload, "subscriptionId");
            const subscriptionId = event.subscriptionId || subscriptionIdFromPayload;

            if (subscriptionId) {
                const currentPeriodStart = readPayloadDate(event.payload, "currentPeriodStart") || new Date();
                const currentPeriodEnd = readPayloadDate(event.payload, "currentPeriodEnd") || addMonths(new Date(), 1);

                await prisma.subscription.update({
                    where: { id: subscriptionId },
                    data: {
                        status: SubscriptionStatus.ACTIVE,
                        currentPeriodStart,
                        currentPeriodEnd,
                        graceUntil: null,
                        cancelAtPeriodEnd: false,
                    },
                });
            }
        }

        return prisma.paymentEvent.update({
            where: { id: event.id },
            data: {
                status: PaymentEventStatus.PROCESSED,
                processedAt: new Date(),
                lastError: null,
            },
        });
    } catch (error) {
        const retries = event.retries + 1;
        const retryDelayMinutes = Math.min(60, Math.pow(2, retries));
        return prisma.paymentEvent.update({
            where: { id: event.id },
            data: {
                status: PaymentEventStatus.FAILED,
                retries,
                lastError: error instanceof Error ? error.message : "Unknown error",
                nextRetryAt: new Date(Date.now() + retryDelayMinutes * 60 * 1000),
            },
        });
    }
}

async function ingestPaymentWebhook(input: {
    organizationId: string;
    provider: PaymentProvider;
    idempotencyKey: string;
    eventType: string;
    payload: Record<string, unknown>;
    providerEventId?: string;
    subscriptionId?: string;
    invoiceId?: string;
    amountCents?: number;
    currency?: string;
}) {
    const existing = await prisma.paymentEvent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
    });

    if (existing) {
        return existing;
    }

    const paymentEvent = await prisma.paymentEvent.create({
        data: {
            organizationId: input.organizationId,
            subscriptionId: input.subscriptionId,
            invoiceId: input.invoiceId,
            provider: input.provider,
            providerEventId: input.providerEventId,
            idempotencyKey: input.idempotencyKey,
            eventType: input.eventType,
            status: PaymentEventStatus.RECEIVED,
            amountCents: input.amountCents,
            currency: input.currency,
            payload: input.payload as Prisma.InputJsonValue,
        },
    });

    return processPaymentEventById(paymentEvent.id);
}

async function retryFailedPaymentEvents(limit: number = 20) {
    const events = await prisma.paymentEvent.findMany({
        where: {
            status: PaymentEventStatus.FAILED,
            nextRetryAt: {
                lte: new Date(),
            },
        },
        orderBy: { nextRetryAt: "asc" },
        take: limit,
        select: { id: true },
    });

    const results = [];
    for (const event of events) {
        results.push(await processPaymentEventById(event.id));
    }

    return results;
}

export const billingService = {
    ensurePlanCatalogExists,
    ensureOrganizationSubscription,
    getCurrentSubscription,
    listPlans,
    getBillingSnapshot,
    evaluateUsageLimit,
    consumeUsage,
    recordUsageEvent,
    changePlan,
    cancelSubscription,
    createSubscriptionInvoice,
    markSubscriptionPastDue,
    ingestPaymentWebhook,
    retryFailedPaymentEvents,
};

export type { BillingSnapshot, UsageCheckResult, UsageConsumeInput };
