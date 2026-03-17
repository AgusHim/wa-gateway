"use server";

import { BillingCycle, KnowledgeSourceType, PlanCode, TenantRole, WebhookEndpointStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { billingService } from "@/lib/billing/service";
import { authSessionRepo } from "@/lib/db/authSessionRepo";
import { prisma } from "@/lib/db/client";
import { requireSessionPermission, requireSessionTenantContext } from "@/lib/auth/sessionContext";
import { configRepo } from "@/lib/db/configRepo";
import { memoryRepo } from "@/lib/db/memoryRepo";
import { messageRepo } from "@/lib/db/messageRepo";
import { userRepo } from "@/lib/db/userRepo";
import { workspaceApiKeyRepo } from "@/lib/db/workspaceApiKeyRepo";
import { workspaceCredentialRepo } from "@/lib/db/workspaceCredentialRepo";
import { workspacePromptRepo } from "@/lib/db/workspacePromptRepo";
import { workspaceToolPolicyRepo } from "@/lib/db/workspaceToolPolicyRepo";
import { createOrganizationInvite } from "@/lib/auth/tenantAuthService";
import { handoverRepo } from "@/lib/handover/repo";
import { campaignService } from "@/lib/automation/campaignService";
import { webhookService } from "@/lib/integrations/webhookService";
import {
    InstagramAutoReplyRules,
    upsertWorkspaceInstagramAutoReplyRules,
} from "@/lib/integrations/instagram/ruleConfig";
import { knowledgeService } from "@/lib/knowledge/service";
import { sendTenantEmail } from "@/lib/notifications/email";
import { replayWorkspaceDeadLetter } from "@/lib/observability/deadLetter";
import { assertTrustedServerActionOrigin } from "@/lib/security/csrf";
import { invalidateWorkspaceRuntimeFlags } from "@/lib/tenant/flags";

async function assertSensitiveActionRequest() {
    await assertTrustedServerActionOrigin();
}

export async function toggleBotActive(formData: FormData) {
    const { workspaceId } = await requireSessionPermission("manage_channel");

    const current = formData.get("current") === "true";

    await configRepo.updateBotConfig(workspaceId, {
        isActive: !current,
    });

    revalidatePath("/");
}

export async function updateBotConfigAction(formData: FormData) {
    const { workspaceId } = await requireSessionPermission("manage_channel");

    const isActive = formData.get("isActive") === "true";
    const model = String(formData.get("model") || "gemini-2.5-flash-lite").trim();
    const maxTokensRaw = Number(formData.get("maxTokens"));
    const maxTokens = Number.isFinite(maxTokensRaw) ? maxTokensRaw : 1024;
    const temperatureRaw = Number(formData.get("temperature"));
    const temperature = Number.isFinite(temperatureRaw)
        ? Math.max(0, Math.min(1, temperatureRaw))
        : 0.4;
    const safetyProfile = String(formData.get("safetyProfile") || "balanced").trim().toLowerCase();
    const fallbackModelsRaw = String(formData.get("fallbackModels") || "");
    const fallbackModels = fallbackModelsRaw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const memoryRetentionDaysRaw = Number(formData.get("memoryRetentionDays"));
    const memoryRetentionDays = Number.isFinite(memoryRetentionDaysRaw)
        ? Math.max(1, Math.min(3650, Math.round(memoryRetentionDaysRaw)))
        : 90;
    const piiRedactionEnabled = formData.get("piiRedactionEnabled") === "true";
    const timezone = String(formData.get("timezone") || "Asia/Jakarta").trim() || "Asia/Jakarta";
    const businessHoursStart = String(formData.get("businessHoursStart") || "08:00").trim() || "08:00";
    const businessHoursEnd = String(formData.get("businessHoursEnd") || "20:00").trim() || "20:00";
    const businessDays = formData
        .getAll("businessDays")
        .map((item) => Number(item))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
    const outOfHoursAutoReplyEnabled = formData.get("outOfHoursAutoReplyEnabled") === "true";
    const outOfHoursMessage = String(
        formData.get("outOfHoursMessage")
        || "Terima kasih, pesan Anda sudah diterima. Tim kami akan membalas pada jam operasional."
    ).trim();

    await configRepo.updateBotConfig(workspaceId, {
        isActive,
        model,
        maxTokens,
        temperature,
        safetyProfile,
        fallbackModels,
        memoryRetentionDays,
        piiRedactionEnabled,
        timezone,
        businessHoursStart,
        businessHoursEnd,
        businessDays: businessDays.length > 0 ? businessDays : [1, 2, 3, 4, 5],
        outOfHoursAutoReplyEnabled,
        outOfHoursMessage,
    });

    revalidatePath("/config");
    revalidatePath("/");
}

export async function createPromptVersionAction(formData: FormData) {
    const { workspaceId, userId } = await requireSessionPermission("manage_channel");

    const title = String(formData.get("title") || "").trim();
    const identity = String(formData.get("identity") || "").trim();
    const behavior = String(formData.get("behavior") || "").trim();
    const skills = String(formData.get("skills") || "").trim();
    const tools = String(formData.get("tools") || "").trim();
    const memory = String(formData.get("memory") || "").trim();

    if (!identity || !behavior || !skills) {
        throw new Error("Identity, Behavior, dan Skills wajib diisi");
    }

    await workspacePromptRepo.createPromptVersion({
        workspaceId,
        title: title || undefined,
        createdByUserId: userId,
        activate: true,
        payload: {
            identity,
            behavior,
            skills,
            tools,
            memory,
        },
    });

    revalidatePath("/config");
}

export async function activatePromptVersionAction(formData: FormData) {
    const { workspaceId } = await requireSessionPermission("manage_channel");
    const versionId = String(formData.get("versionId") || "").trim();
    if (!versionId) {
        throw new Error("versionId is required");
    }

    await workspacePromptRepo.activatePromptVersion(workspaceId, versionId);
    revalidatePath("/config");
}

export async function upsertWorkspaceCredentialAction(formData: FormData) {
    await assertSensitiveActionRequest();
    const { workspaceId, userId } = await requireSessionPermission("manage_channel");

    const provider = String(formData.get("provider") || "custom").trim();
    const name = String(formData.get("name") || "").trim();
    const secret = String(formData.get("secret") || "").trim();

    if (!name || !secret) {
        throw new Error("Nama credential dan secret wajib diisi");
    }

    await workspaceCredentialRepo.upsertCredential({
        workspaceId,
        provider,
        name,
        secret,
        createdByUserId: userId,
    });

    revalidatePath("/config");
}

export async function deleteWorkspaceCredentialAction(formData: FormData) {
    await assertSensitiveActionRequest();
    const { workspaceId } = await requireSessionPermission("manage_channel");
    const name = String(formData.get("name") || "").trim();
    if (!name) {
        throw new Error("Credential name is required");
    }

    await workspaceCredentialRepo.deleteCredential(workspaceId, name);
    revalidatePath("/config");
}

export async function upsertWorkspaceToolPolicyAction(formData: FormData) {
    const { workspaceId } = await requireSessionPermission("manage_channel");

    const toolName = String(formData.get("toolName") || "").trim();
    if (!toolName) {
        throw new Error("toolName is required");
    }

    const isEnabled = formData.get("isEnabled") === "true";
    const allowedRoleValues = formData
        .getAll("allowedRoles")
        .map((item) => String(item))
        .filter((value): value is TenantRole => Object.values(TenantRole).includes(value as TenantRole));

    await workspaceToolPolicyRepo.upsertPolicy({
        workspaceId,
        toolName,
        isEnabled,
        allowedRoles: allowedRoleValues.length > 0 ? allowedRoleValues : [TenantRole.OWNER, TenantRole.ADMIN, TenantRole.OPERATOR],
    });

    revalidatePath("/config");
}

export async function createCampaignAction(formData: FormData) {
    const { workspaceId } = await requireSessionPermission("write");

    const name = String(formData.get("name") || "").trim();
    const messageTemplate = String(formData.get("messageTemplate") || "").trim();
    const label = String(formData.get("label") || "").trim() || undefined;
    const segment = String(formData.get("segment") || "").trim() || undefined;
    const memoryKey = String(formData.get("memoryKey") || "").trim() || undefined;
    const memoryValueContains = String(formData.get("memoryValueContains") || "").trim() || undefined;
    const lastActiveWithinDaysRaw = Number(formData.get("lastActiveWithinDays"));
    const lastActiveWithinDays = Number.isFinite(lastActiveWithinDaysRaw)
        ? Math.max(1, Math.min(3650, Math.round(lastActiveWithinDaysRaw)))
        : undefined;
    const scheduledAtRaw = String(formData.get("scheduledAt") || "").trim();
    const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
    const throttleRaw = Number(formData.get("throttlePerSecond"));
    const throttlePerSecond = Number.isFinite(throttleRaw)
        ? Math.max(1, Math.min(100, Math.round(throttleRaw)))
        : 5;

    if (!name || !messageTemplate) {
        throw new Error("Campaign name dan message template wajib diisi");
    }

    await campaignService.createCampaign({
        workspaceId,
        name,
        messageTemplate,
        scheduledAt,
        throttlePerSecond,
        segment: {
            label,
            segment,
            memoryKey,
            memoryValueContains,
            lastActiveWithinDays,
        },
    });

    revalidatePath("/campaigns");
}

export async function dispatchCampaignNowAction(formData: FormData) {
    const { workspaceId } = await requireSessionPermission("manage_channel");
    const campaignId = String(formData.get("campaignId") || "").trim();
    if (!campaignId) {
        throw new Error("campaignId is required");
    }

    const campaign = await campaignService.getCampaignById(workspaceId, campaignId);
    if (!campaign) {
        throw new Error("Campaign not found");
    }

    await campaignService.dispatchCampaign(campaign.id);
    revalidatePath("/campaigns");
}

export async function uploadKnowledgeSourceAction(formData: FormData) {
    const { workspaceId, userId } = await requireSessionPermission("write");

    const title = String(formData.get("title") || "").trim();
    const typeRaw = String(formData.get("type") || KnowledgeSourceType.TEXT);
    const type = Object.values(KnowledgeSourceType).includes(typeRaw as KnowledgeSourceType)
        ? (typeRaw as KnowledgeSourceType)
        : KnowledgeSourceType.TEXT;
    const sourceUrl = String(formData.get("sourceUrl") || "").trim() || undefined;
    let content = String(formData.get("content") || "").trim();
    let fileName: string | undefined;

    const file = formData.get("file");
    if (file instanceof File && file.size > 0) {
        fileName = file.name;
        const fileText = await file.text();
        if (fileText.trim()) {
            content = fileText.trim();
        }
    }

    if (!content && type === KnowledgeSourceType.URL && sourceUrl) {
        const response = await fetch(sourceUrl, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Gagal fetch URL knowledge (${response.status})`);
        }
        content = (await response.text()).trim();
    }

    if (!title || !content) {
        throw new Error("Title dan content knowledge wajib diisi");
    }

    await knowledgeService.createSource({
        workspaceId,
        title,
        type,
        sourceUrl,
        fileName,
        content,
        createdByUserId: userId,
    });

    revalidatePath("/knowledge");
}

export async function archiveKnowledgeSourceAction(formData: FormData) {
    const { workspaceId } = await requireSessionPermission("write");
    const sourceId = String(formData.get("sourceId") || "").trim();
    if (!sourceId) {
        throw new Error("sourceId is required");
    }

    await knowledgeService.archiveSource(workspaceId, sourceId);
    revalidatePath("/knowledge");
}

export async function createWorkspaceApiKeyAction(formData: FormData) {
    await assertSensitiveActionRequest();
    const { workspaceId, userId } = await requireSessionPermission("manage_channel");

    const name = String(formData.get("name") || "").trim();
    const scopesRaw = String(formData.get("scopes") || "").trim();
    const expiresAtRaw = String(formData.get("expiresAt") || "").trim();
    const scopes = scopesRaw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;

    if (!name) {
        throw new Error("API key name is required");
    }

    const created = await workspaceApiKeyRepo.createKey({
        workspaceId,
        name,
        scopes,
        expiresAt,
        createdByUserId: userId,
    });

    revalidatePath("/integrations");
    redirect(`/integrations?newApiKey=${encodeURIComponent(created.rawKey)}&keyName=${encodeURIComponent(name)}`);
}

export async function rotateWorkspaceApiKeyAction(formData: FormData) {
    await assertSensitiveActionRequest();
    const { workspaceId } = await requireSessionPermission("manage_channel");
    const keyId = String(formData.get("keyId") || "").trim();
    if (!keyId) {
        throw new Error("keyId is required");
    }

    const rotated = await workspaceApiKeyRepo.rotateKey(workspaceId, keyId);
    revalidatePath("/integrations");
    redirect(`/integrations?rotatedApiKey=${encodeURIComponent(rotated.rawKey)}&keyId=${encodeURIComponent(keyId)}`);
}

export async function revokeWorkspaceApiKeyAction(formData: FormData) {
    await assertSensitiveActionRequest();
    const { workspaceId } = await requireSessionPermission("manage_channel");
    const keyId = String(formData.get("keyId") || "").trim();
    if (!keyId) {
        throw new Error("keyId is required");
    }

    await workspaceApiKeyRepo.revokeKey(workspaceId, keyId);
    revalidatePath("/integrations");
}

export async function createWebhookEndpointAction(formData: FormData) {
    await assertSensitiveActionRequest();
    const { workspaceId, userId } = await requireSessionPermission("manage_channel");

    const name = String(formData.get("name") || "").trim();
    const url = String(formData.get("url") || "").trim();
    const secret = String(formData.get("secret") || "").trim();
    const timeoutMsRaw = Number(formData.get("timeoutMs"));
    const timeoutMs = Number.isFinite(timeoutMsRaw)
        ? Math.max(1000, Math.min(30000, Math.round(timeoutMsRaw)))
        : 10000;
    const maxAttemptsRaw = Number(formData.get("maxAttempts"));
    const maxAttempts = Number.isFinite(maxAttemptsRaw)
        ? Math.max(1, Math.min(20, Math.round(maxAttemptsRaw)))
        : 6;
    const events = formData.getAll("events").map((item) => String(item).trim().toUpperCase()).filter(Boolean);

    if (!name || !url || !secret) {
        throw new Error("name, url, dan secret wajib diisi");
    }

    await webhookService.createEndpoint({
        workspaceId,
        name,
        url,
        secret,
        timeoutMs,
        maxAttempts,
        events,
        createdByUserId: userId,
    });

    revalidatePath("/integrations");
}

export async function updateWebhookEndpointStatusAction(formData: FormData) {
    await assertSensitiveActionRequest();
    const { workspaceId } = await requireSessionPermission("manage_channel");
    const endpointId = String(formData.get("endpointId") || "").trim();
    const statusRaw = String(formData.get("status") || "").trim().toUpperCase();
    const status = Object.values(WebhookEndpointStatus).includes(statusRaw as WebhookEndpointStatus)
        ? (statusRaw as WebhookEndpointStatus)
        : null;
    if (!endpointId || !status) {
        throw new Error("Invalid webhook endpoint status request");
    }

    await webhookService.updateEndpointStatus(workspaceId, endpointId, status);
    revalidatePath("/integrations");
}

export async function replayWebhookDeliveryAction(formData: FormData) {
    await assertSensitiveActionRequest();
    const { workspaceId } = await requireSessionPermission("manage_channel");
    const deliveryId = String(formData.get("deliveryId") || "").trim();
    if (!deliveryId) {
        throw new Error("deliveryId is required");
    }

    await webhookService.replayDelivery(workspaceId, deliveryId);
    revalidatePath("/integrations");
}

export async function replayDeadLetterJobAction(formData: FormData) {
    await assertSensitiveActionRequest();
    const { workspaceId } = await requireSessionPermission("manage_channel");
    const directionRaw = String(formData.get("direction") || "").trim().toLowerCase();
    const dlqJobId = String(formData.get("dlqJobId") || "").trim();
    const channelId = String(formData.get("channelId") || "").trim() || undefined;
    const windowMinutes = String(formData.get("windowMinutes") || "").trim();

    if (directionRaw !== "inbound" && directionRaw !== "outbound") {
        throw new Error("direction is required");
    }

    if (!dlqJobId) {
        throw new Error("dlqJobId is required");
    }

    await replayWorkspaceDeadLetter({
        workspaceId,
        direction: directionRaw,
        dlqJobId,
        channelId,
    });

    revalidatePath("/observability");

    const params = new URLSearchParams();
    if (windowMinutes) {
        params.set("windowMinutes", windowMinutes);
    }
    params.set("replay", "success");
    params.set("direction", directionRaw);

    redirect(`/observability?${params.toString()}`);
}

export async function createSandboxWorkspaceAction() {
    await assertSensitiveActionRequest();
    const { organizationId, userId } = await requireSessionTenantContext([TenantRole.OWNER, TenantRole.ADMIN]);
    const { tenantRepo } = await import("@/lib/db/tenantRepo");
    const workspace = await tenantRepo.createSandboxWorkspace({
        organizationId,
        userId,
    });

    revalidatePath("/integrations");
    redirect(`/integrations?sandboxWorkspaceId=${encodeURIComponent(workspace.id)}`);
}

function slugifyValue(input: string): string {
    return input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "workspace";
}

async function ensureUniqueWorkspaceSlug(organizationId: string, baseSlug: string): Promise<string> {
    let candidate = baseSlug;
    let counter = 1;

    while (true) {
        const existing = await prisma.workspace.findFirst({
            where: {
                organizationId,
                slug: candidate,
            },
            select: { id: true },
        });
        if (!existing) return candidate;
        counter += 1;
        candidate = `${baseSlug}-${counter}`;
    }
}

async function ensureUniqueOrganizationSlug(baseSlug: string, organizationId: string): Promise<string> {
    let candidate = baseSlug;
    let counter = 1;

    while (true) {
        const existing = await prisma.organization.findFirst({
            where: {
                slug: candidate,
                id: { not: organizationId },
            },
            select: { id: true },
        });
        if (!existing) return candidate;
        counter += 1;
        candidate = `${baseSlug}-${counter}`;
    }
}

export async function updateOrganizationSettingsAction(formData: FormData) {
    const { organizationId, membershipRole } = await requireSessionTenantContext();
    if (membershipRole !== TenantRole.OWNER && membershipRole !== TenantRole.ADMIN) {
        throw new Error("Forbidden");
    }

    const name = String(formData.get("name") || "").trim();
    const slugRaw = String(formData.get("slug") || "").trim();

    if (!name) {
        throw new Error("Organization name is required");
    }

    const nextSlugBase = slugRaw ? slugifyValue(slugRaw) : undefined;
    const nextSlug = nextSlugBase
        ? await ensureUniqueOrganizationSlug(nextSlugBase, organizationId)
        : undefined;

    await prisma.organization.update({
        where: { id: organizationId },
        data: {
            name,
            slug: nextSlug,
        },
    });

    revalidatePath("/organization");
    revalidatePath("/");
}

export async function createOrganizationWorkspaceAction(formData: FormData) {
    const { organizationId, userId, membershipRole } = await requireSessionTenantContext();
    if (membershipRole !== TenantRole.OWNER && membershipRole !== TenantRole.ADMIN) {
        throw new Error("Forbidden");
    }

    const name = String(formData.get("name") || "").trim();
    const slugRaw = String(formData.get("slug") || "").trim();

    if (!name) {
        throw new Error("Workspace name is required");
    }

    const baseSlug = slugifyValue(slugRaw || name);
    const slug = await ensureUniqueWorkspaceSlug(organizationId, baseSlug);

    const createdWorkspaceId = await prisma.$transaction(async (tx) => {
        const workspace = await tx.workspace.create({
            data: {
                organizationId,
                name,
                slug,
                isActive: true,
            },
        });

        await tx.workspaceConfig.create({
            data: {
                workspaceId: workspace.id,
                isActive: true,
                model: "gemini-2.5-flash-lite",
                maxTokens: 1024,
            },
        });

        await tx.workspaceMembership.upsert({
            where: {
                workspaceId_userId: {
                    workspaceId: workspace.id,
                    userId,
                },
            },
            update: {
                role: membershipRole,
            },
            create: {
                workspaceId: workspace.id,
                userId,
                role: membershipRole,
            },
        });

        return workspace.id;
    });

    invalidateWorkspaceRuntimeFlags(createdWorkspaceId);
    revalidatePath("/organization");
}

export async function toggleOrganizationActiveAction(formData: FormData) {
    const { platformRole } = await requireSessionTenantContext([TenantRole.OWNER]);
    if (platformRole !== TenantRole.OWNER) {
        throw new Error("Forbidden");
    }

    const organizationId = String(formData.get("organizationId") || "").trim();
    const nextIsActive = formData.get("nextIsActive") === "true";

    if (!organizationId) {
        throw new Error("organizationId is required");
    }

    await prisma.organization.update({
        where: { id: organizationId },
        data: {
            isActive: nextIsActive,
        },
    });

    const workspaces = await prisma.workspace.findMany({
        where: { organizationId },
        select: { id: true },
    });
    for (const workspace of workspaces) {
        invalidateWorkspaceRuntimeFlags(workspace.id);
    }

    revalidatePath("/super-admin");
}

export async function updateUserLabelAction(formData: FormData) {
    const { workspaceId } = await requireSessionPermission("write");

    const userId = String(formData.get("userId") || "");
    const labelRaw = String(formData.get("label") || "").trim();
    const label = labelRaw.length > 0 ? labelRaw : null;

    if (!userId) {
        throw new Error("Invalid user");
    }

    await userRepo.updateLabel(userId, label, workspaceId);
    revalidatePath("/users");
    revalidatePath("/conversations");
}

export async function toggleUserBlockAction(formData: FormData) {
    const { workspaceId } = await requireSessionPermission("write");

    const userId = String(formData.get("userId") || "");
    const nextBlocked = formData.get("nextBlocked") === "true";

    if (!userId) {
        throw new Error("Invalid user");
    }

    await userRepo.blockUser(userId, nextBlocked, workspaceId);
    revalidatePath("/users");
}

export async function resolveUserHandoverAction(formData: FormData) {
    const { workspaceId } = await requireSessionPermission("write");

    const userId = String(formData.get("userId") || "");
    if (!userId) {
        throw new Error("Invalid user");
    }

    const user = await userRepo.getUserById(userId, workspaceId);
    if (!user) {
        throw new Error("User not found");
    }

    await handoverRepo.clearPending(user.phoneNumber, workspaceId);
    revalidatePath("/users");
    revalidatePath("/conversations");
}

export async function takeoverInstagramThreadAction(formData: FormData) {
    const { workspaceId, userId: actorUserId } = await requireSessionPermission("write");
    const userId = String(formData.get("userId") || "").trim();
    const threadId = String(formData.get("threadId") || "").trim();
    const channelId = String(formData.get("channelId") || "").trim() || undefined;

    if (!userId || !threadId) {
        throw new Error("userId dan threadId wajib diisi");
    }

    const user = await userRepo.getUserById(userId, workspaceId);
    if (!user) {
        throw new Error("User tidak ditemukan");
    }

    await messageRepo.setInstagramThreadAutoReplyState({
        workspaceId,
        userId: user.id,
        threadId,
        channelId,
        enabled: false,
        changedBy: `operator:${actorUserId}`,
    });

    await handoverRepo.markPending({
        workspaceId,
        phoneNumber: user.phoneNumber,
        userId: user.id,
        topic: "instagram_thread_takeover",
        keyword: threadId,
        triggeredBy: "operator_takeover",
    });

    revalidatePath("/conversations");
    revalidatePath("/users");
}

export async function toggleInstagramThreadAutoReplyAction(formData: FormData) {
    const { workspaceId, userId: actorUserId } = await requireSessionPermission("write");
    const userId = String(formData.get("userId") || "").trim();
    const threadId = String(formData.get("threadId") || "").trim();
    const channelId = String(formData.get("channelId") || "").trim() || undefined;
    const enabled = formData.get("enabled") === "true";

    if (!userId || !threadId) {
        throw new Error("userId dan threadId wajib diisi");
    }

    const user = await userRepo.getUserById(userId, workspaceId);
    if (!user) {
        throw new Error("User tidak ditemukan");
    }

    await messageRepo.setInstagramThreadAutoReplyState({
        workspaceId,
        userId: user.id,
        threadId,
        channelId,
        enabled,
        changedBy: `operator:${actorUserId}`,
    });

    revalidatePath("/conversations");
}

function parseCommaList(value: string): string[] {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

export async function updateInstagramAutoReplyRulesAction(formData: FormData) {
    const { workspaceId, userId } = await requireSessionPermission("manage_channel");

    const rules: InstagramAutoReplyRules = {
        comment: {
            enabled: formData.get("commentEnabled") === "true",
            keywordMode: formData.get("commentKeywordMode") === "keywords" ? "keywords" : "all",
            keywords: parseCommaList(String(formData.get("commentKeywords") || "")),
            sentimentThreshold: Number(formData.get("commentSentimentThreshold")),
        },
        dm: {
            enabled: formData.get("dmEnabled") === "true",
            keywordMode: formData.get("dmKeywordMode") === "keywords" ? "keywords" : "all",
            keywords: parseCommaList(String(formData.get("dmKeywords") || "")),
            businessHoursOnly: formData.get("dmBusinessHoursOnly") === "true",
            fallbackMessage: String(formData.get("dmFallbackMessage") || "").trim(),
            escalationPolicy: String(formData.get("dmEscalationPolicy") || "none").trim() || "none",
        },
    };

    await upsertWorkspaceInstagramAutoReplyRules({
        workspaceId,
        userId,
        rules,
    });

    revalidatePath("/config");
}

export async function upsertUserMemoryAction(formData: FormData) {
    const { workspaceId } = await requireSessionPermission("write");

    const userId = String(formData.get("userId") || "");
    const key = String(formData.get("key") || "").trim();
    const value = String(formData.get("value") || "").trim();

    if (!userId || !key || !value) {
        throw new Error("Invalid memory input");
    }

    await memoryRepo.upsertMemory({
        workspaceId,
        userId,
        key,
        value,
    });

    revalidatePath(`/users/${userId}`);
}

export async function createTeamInviteAction(formData: FormData) {
    const { userId, organizationId, workspaceId } = await requireSessionTenantContext([TenantRole.OWNER, TenantRole.ADMIN]);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const roleValue = String(formData.get("role") || TenantRole.VIEWER);
    const role = Object.values(TenantRole).includes(roleValue as TenantRole)
        ? (roleValue as TenantRole)
        : TenantRole.VIEWER;

    if (!email) {
        throw new Error("Email is required");
    }

    if (role === TenantRole.OWNER) {
        throw new Error("Owner invite is not supported");
    }

    const billingSnapshot = await billingService.getBillingSnapshot(workspaceId);
    if (billingSnapshot.usage.seats.used >= billingSnapshot.usage.seats.limit) {
        throw new Error("Seat limit reached for current plan");
    }

    const { rawToken } = await createOrganizationInvite({
        inviterUserId: userId,
        organizationId,
        email,
        role,
    });

    const appUrl = process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
    const inviteLink = `${appUrl}/accept-invite?token=${encodeURIComponent(rawToken)}`;
    await sendTenantEmail({
        to: email,
        subject: "Undangan bergabung ke WA Gateway",
        text: `Anda diundang bergabung ke organisasi. Buka link berikut untuk menerima undangan: ${inviteLink}`,
    });

    revalidatePath("/team");
}

export async function revokeAuthSessionAction(formData: FormData) {
    const { userId } = await requireSessionTenantContext();
    const sessionId = String(formData.get("sessionId") || "").trim();
    if (!sessionId) {
        throw new Error("Session ID is required");
    }

    await authSessionRepo.revokeSessionById(userId, sessionId);
    revalidatePath("/config");
}

export async function revokeAllAuthSessionsAction() {
    const { userId } = await requireSessionTenantContext();

    await prisma.$transaction(async (tx) => {
        await tx.authSession.updateMany({
            where: {
                userId,
                revokedAt: null,
            },
            data: { revokedAt: new Date() },
        });

        await tx.user.update({
            where: { id: userId },
            data: {
                sessionVersion: { increment: 1 },
            },
        });
    });

    revalidatePath("/config");
}

export async function changeBillingPlanAction(formData: FormData) {
    await assertSensitiveActionRequest();
    const { organizationId } = await requireSessionPermission("manage_billing");

    const planCodeRaw = String(formData.get("planCode") || PlanCode.FREE);
    const billingCycleRaw = String(formData.get("billingCycle") || BillingCycle.MONTHLY);

    const planCode = Object.values(PlanCode).includes(planCodeRaw as PlanCode)
        ? (planCodeRaw as PlanCode)
        : PlanCode.FREE;
    const billingCycle = Object.values(BillingCycle).includes(billingCycleRaw as BillingCycle)
        ? (billingCycleRaw as BillingCycle)
        : BillingCycle.MONTHLY;

    await billingService.changePlan({
        organizationId,
        planCode,
        billingCycle,
    });

    revalidatePath("/billing");
}

export async function cancelBillingSubscriptionAction(formData: FormData) {
    await assertSensitiveActionRequest();
    const { organizationId } = await requireSessionPermission("manage_billing");
    const immediate = formData.get("immediate") === "true";

    await billingService.cancelSubscription(organizationId, immediate);
    revalidatePath("/billing");
}

export async function retryFailedBillingEventsAction(formData: FormData) {
    await assertSensitiveActionRequest();
    await requireSessionPermission("manage_billing");

    const limitRaw = Number(formData.get("limit"));
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.round(limitRaw))) : 20;
    await billingService.retryFailedPaymentEvents(limit);

    revalidatePath("/billing");
}
