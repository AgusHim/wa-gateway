import { messageRepo } from "@/lib/db/messageRepo";
import { memoryRepo } from "@/lib/db/memoryRepo";
import { buildHistoryMessages } from "@/agent/prompts/historyPrompt";
import { buildMemoryPrompt } from "@/agent/prompts/memoryPrompt";
import { buildSystemPrompt } from "@/agent/prompts/systemPrompt";
import { AgentState } from "@/agent/types";

type Memory = {
    id: string;
    updatedAt: Date;
    userId: string;
    key: string;
    value: string;
    confidence: number;
    source: string | null;
};

export async function loadContextNode(state: AgentState): Promise<Partial<AgentState>> {
    const [memories, recentMessages] = await Promise.all([
        memoryRepo.getMemoriesByUser(state.userId) as Promise<Memory[]>,
        messageRepo.getRecentHistory(state.userId, 10),
    ]);

    return {
        systemPrompt: buildSystemPrompt(),
        memoryContext: buildMemoryPrompt(memories),
        history: buildHistoryMessages(recentMessages),
    };
}