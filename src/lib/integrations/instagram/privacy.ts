import { prisma } from "@/lib/db/client";
import { channelRepo } from "@/lib/db/channelRepo";
import { assertTenantScope } from "@/lib/tenant/context";
import { isInstagramScopedUserIdentifier, resolveInstagramRetentionPolicy } from "./privacyPolicy";

export type InstagramUserDeletionSummary = {
    workspaceId: string;
    userId: string;
    userIdentifier: string;
    deletedMessages: number;
    deletedMemories: number;
    deletedHandoverTickets: number;
    deletedCampaignRecipients: number;
    deletedUser: boolean;
    retentionPolicy: ReturnType<typeof resolveInstagramRetentionPolicy>;
};

export async function deleteInstagramUserData(input: {
    workspaceId: string;
    userId: string;
    deletedByUserId?: string;
}): Promise<InstagramUserDeletionSummary> {
    const workspaceId = assertTenantScope(input.workspaceId);
    const userId = input.userId.trim();
    if (!userId) {
        throw new Error("userId is required");
    }

    const user = await prisma.chatUser.findFirst({
        where: {
            id: userId,
            workspaceId,
        },
        select: {
            id: true,
            phoneNumber: true,
        },
    });

    if (!user) {
        throw new Error("Instagram user not found in workspace");
    }

    if (!isInstagramScopedUserIdentifier(user.phoneNumber)) {
        throw new Error("Deletion workflow hanya berlaku untuk user Instagram");
    }

    const result = await prisma.$transaction(async (tx) => {
        const deletedMessages = await tx.message.deleteMany({
            where: {
                workspaceId,
                userId: user.id,
            },
        });
        const deletedMemories = await tx.memory.deleteMany({
            where: {
                workspaceId,
                userId: user.id,
            },
        });
        const deletedHandoverTickets = await tx.handoverTicket.deleteMany({
            where: {
                workspaceId,
                OR: [
                    { userId: user.id },
                    { phoneNumber: user.phoneNumber },
                ],
            },
        });
        const deletedCampaignRecipients = await tx.campaignRecipient.deleteMany({
            where: {
                workspaceId,
                OR: [
                    { userId: user.id },
                    { phoneNumber: user.phoneNumber },
                ],
            },
        });
        const deletedUser = await tx.chatUser.deleteMany({
            where: {
                id: user.id,
                workspaceId,
            },
        });

        return {
            deletedMessages: deletedMessages.count,
            deletedMemories: deletedMemories.count,
            deletedHandoverTickets: deletedHandoverTickets.count,
            deletedCampaignRecipients: deletedCampaignRecipients.count,
            deletedUser: deletedUser.count > 0,
        };
    });

    const instagramChannels = await channelRepo.listWorkspaceChannels(workspaceId, {
        provider: "instagram",
    });

    await Promise.all(instagramChannels.map((channel) => channelRepo.createAudit(channel.id, {
        eventType: "instagram_user_data_deleted",
        status: "success",
        message: "manual_privacy_deletion",
        metadata: {
            deletedByUserId: input.deletedByUserId || null,
            targetUserId: user.id,
            targetIdentifier: user.phoneNumber,
            deletedMessages: result.deletedMessages,
            deletedMemories: result.deletedMemories,
            deletedHandoverTickets: result.deletedHandoverTickets,
            deletedCampaignRecipients: result.deletedCampaignRecipients,
        },
    })));

    return {
        workspaceId,
        userId: user.id,
        userIdentifier: user.phoneNumber,
        deletedMessages: result.deletedMessages,
        deletedMemories: result.deletedMemories,
        deletedHandoverTickets: result.deletedHandoverTickets,
        deletedCampaignRecipients: result.deletedCampaignRecipients,
        deletedUser: result.deletedUser,
        retentionPolicy: resolveInstagramRetentionPolicy(),
    };
}
