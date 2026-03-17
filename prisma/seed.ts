import { BillingCycle, ChannelProvider, PaymentProvider, PlanCode, PrismaClient, SubscriptionStatus } from "@prisma/client";

const prisma = new PrismaClient({});
const defaultOrganizationId = process.env.DEFAULT_ORGANIZATION_ID || "default-org";
const defaultWorkspaceId = process.env.DEFAULT_WORKSPACE_ID || "default-workspace";
const defaultChannelId = process.env.DEFAULT_CHANNEL_ID || "default-channel";

const planSeeds = [
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

async function main() {
    console.log("🌱 Seeding database...");

    await prisma.organization.upsert({
        where: { id: defaultOrganizationId },
        update: {},
        create: {
            id: defaultOrganizationId,
            name: "Default Organization",
            slug: defaultOrganizationId,
            isActive: true,
        },
    });

    await prisma.workspace.upsert({
        where: { id: defaultWorkspaceId },
        update: {
            organizationId: defaultOrganizationId,
        },
        create: {
            id: defaultWorkspaceId,
            organizationId: defaultOrganizationId,
            name: "Default Workspace",
            slug: defaultWorkspaceId,
            isActive: true,
        },
    });

    await prisma.channel.upsert({
        where: { id: defaultChannelId },
        update: {
            workspaceId: defaultWorkspaceId,
            provider: "whatsapp",
            providerType: ChannelProvider.WHATSAPP,
        },
        create: {
            id: defaultChannelId,
            workspaceId: defaultWorkspaceId,
            name: "Default WA Channel",
            provider: "whatsapp",
            providerType: ChannelProvider.WHATSAPP,
            status: "active",
        },
    });

    await prisma.workspaceConfig.upsert({
        where: { workspaceId: defaultWorkspaceId },
        update: {},
        create: {
            workspaceId: defaultWorkspaceId,
            isActive: true,
            model: "gemini-2.5-flash-lite",
            maxTokens: 1024,
        },
    });

    for (const plan of planSeeds) {
        await prisma.plan.upsert({
            where: { code: plan.code },
            update: {},
            create: plan,
        });
    }

    await prisma.billingProfile.upsert({
        where: { organizationId: defaultOrganizationId },
        update: {},
        create: {
            organizationId: defaultOrganizationId,
            provider: PaymentProvider.MANUAL,
        },
    });

    const existingSub = await prisma.subscription.findFirst({
        where: {
            organizationId: defaultOrganizationId,
            endedAt: null,
        },
        select: { id: true },
    });

    if (!existingSub) {
        const freePlan = await prisma.plan.findUnique({ where: { code: PlanCode.FREE } });
        if (freePlan) {
            const now = new Date();
            const periodEnd = new Date(now);
            periodEnd.setMonth(periodEnd.getMonth() + 1);

            await prisma.subscription.create({
                data: {
                    organizationId: defaultOrganizationId,
                    planId: freePlan.id,
                    status: SubscriptionStatus.TRIALING,
                    provider: PaymentProvider.MANUAL,
                    billingCycle: BillingCycle.MONTHLY,
                    currentPeriodStart: now,
                    currentPeriodEnd: periodEnd,
                    trialEndAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
                },
            });
        }
    }

    // Create default BotConfig
    await prisma.botConfig.upsert({
        where: { id: "singleton" },
        update: {},
        create: {
            id: "singleton",
            isActive: true,
            model: "gemini-2.5-flash-lite",
            maxTokens: 1024,
        },
    });

    console.log("✅ Default tenant, workspace, channel, config, and billing catalog created");
    console.log("🌱 Seeding complete!");
}

main()
    .catch((e) => {
        console.error("❌ Seed failed:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
