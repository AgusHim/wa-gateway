import { messageRepo } from "@/lib/db/messageRepo";
import { memoryRepo } from "@/lib/db/memoryRepo";
import { workspacePromptRepo } from "@/lib/db/workspacePromptRepo";
import { buildHistoryMessages } from "@/agent/prompts/historyPrompt";
import { buildMemoryPrompt } from "@/agent/prompts/memoryPrompt";
import { buildSystemPrompt } from "@/agent/prompts/systemPrompt";
import { AgentState } from "@/agent/types";

type Memory = {
    id: string;
    updatedAt: Date;
    workspaceId: string;
    userId: string;
    channelId: string | null;
    key: string;
    value: string;
    confidence: number;
    source: string | null;
};

export async function loadContextNode(state: AgentState): Promise<Partial<AgentState>> {
    const [memories, recentMessages, activePrompt] = await Promise.all([
        memoryRepo.getMemoriesByUser(state.userId, state.workspaceId, state.channelId) as Promise<Memory[]>,
        messageRepo.getRecentHistory(state.workspaceId, state.userId, 10),
        workspacePromptRepo.getActivePromptVersion(state.workspaceId),
    ]);

    return {
        systemPrompt: buildSystemPrompt({
            identity: activePrompt?.identity,
            behavior: activePrompt?.behavior,
            skills: activePrompt?.skills,
        }),
        memoryContext: buildMemoryPrompt(memories),
        history: buildHistoryMessages(recentMessages),
    };
}
