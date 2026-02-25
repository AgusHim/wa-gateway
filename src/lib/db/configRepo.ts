import { prisma } from "./client";

export const configRepo = {
    async getBotConfig() {
        let config = await prisma.botConfig.findUnique({
            where: { id: "singleton" },
        });

        if (!config) {
            config = await prisma.botConfig.create({
                data: { id: "singleton" },
            });
        }

        return config;
    },

    async updateBotConfig(data: {
        isActive?: boolean;
        model?: string;
        maxTokens?: number;
    }) {
        return prisma.botConfig.upsert({
            where: { id: "singleton" },
            update: data,
            create: { id: "singleton", ...data },
        });
    },
};
