"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { configRepo } from "@/lib/db/configRepo";
import { memoryRepo } from "@/lib/db/memoryRepo";
import { userRepo } from "@/lib/db/userRepo";
import { handoverRepo } from "@/lib/handover/repo";
import { getInstructionFiles, reloadInstructions, updateInstruction } from "@/lib/instructions/loader";

async function requireSession() {
    const session = await getServerSession(authOptions);
    if (!session) {
        throw new Error("Unauthorized");
    }
}

export async function toggleBotActive(formData: FormData) {
    await requireSession();

    const current = formData.get("current") === "true";

    await configRepo.updateBotConfig({
        isActive: !current,
    });

    revalidatePath("/");
}

export async function updateBotConfigAction(formData: FormData) {
    await requireSession();

    const isActive = formData.get("isActive") === "true";
    const model = String(formData.get("model") || "gemini-2.5-flash-lite").trim();
    const maxTokensRaw = Number(formData.get("maxTokens"));
    const maxTokens = Number.isFinite(maxTokensRaw) ? maxTokensRaw : 1024;

    await configRepo.updateBotConfig({
        isActive,
        model,
        maxTokens,
    });

    revalidatePath("/config");
    revalidatePath("/");
}

export async function saveInstructionAction(formData: FormData) {
    await requireSession();

    const fileName = String(formData.get("fileName") || "");
    const content = String(formData.get("content") || "");
    const allowedFiles = getInstructionFiles();

    if (!allowedFiles.includes(fileName)) {
        throw new Error("Invalid instruction file");
    }

    updateInstruction(fileName, content);
    reloadInstructions();

    revalidatePath("/config");
}

export async function updateUserLabelAction(formData: FormData) {
    await requireSession();

    const userId = String(formData.get("userId") || "");
    const labelRaw = String(formData.get("label") || "").trim();
    const label = labelRaw.length > 0 ? labelRaw : null;

    if (!userId) {
        throw new Error("Invalid user");
    }

    await userRepo.updateLabel(userId, label);
    revalidatePath("/users");
    revalidatePath("/conversations");
}

export async function toggleUserBlockAction(formData: FormData) {
    await requireSession();

    const userId = String(formData.get("userId") || "");
    const nextBlocked = formData.get("nextBlocked") === "true";

    if (!userId) {
        throw new Error("Invalid user");
    }

    await userRepo.blockUser(userId, nextBlocked);
    revalidatePath("/users");
}

export async function resolveUserHandoverAction(formData: FormData) {
    await requireSession();

    const userId = String(formData.get("userId") || "");
    if (!userId) {
        throw new Error("Invalid user");
    }

    const user = await userRepo.getUserById(userId);
    if (!user) {
        throw new Error("User not found");
    }

    await handoverRepo.clearPending(user.phoneNumber);
    revalidatePath("/users");
    revalidatePath("/conversations");
}

export async function upsertUserMemoryAction(formData: FormData) {
    await requireSession();

    const userId = String(formData.get("userId") || "");
    const key = String(formData.get("key") || "").trim();
    const value = String(formData.get("value") || "").trim();

    if (!userId || !key || !value) {
        throw new Error("Invalid memory input");
    }

    await memoryRepo.upsertMemory({
        userId,
        key,
        value,
    });

    revalidatePath(`/users/${userId}`);
}
