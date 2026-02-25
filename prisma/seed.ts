import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log("🌱 Seeding database...");

    // Create default BotConfig
    await prisma.botConfig.upsert({
        where: { id: "singleton" },
        update: {},
        create: {
            id: "singleton",
            isActive: true,
            model: "gemini-2.0-flash",
            maxTokens: 1024,
        },
    });

    console.log("✅ Default BotConfig created");
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
