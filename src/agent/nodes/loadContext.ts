import { messageRepo } from "@/lib/db/messageRepo";
import { memoryRepo } from "@/lib/db/memoryRepo";
import { buildHistoryMessages } from "@/agent/prompts/historyPrompt";
import { buildMemoryPrompt } from "@/agent/prompts/memoryPrompt";
import { buildSystemPrompt } from "@/agent/prompts/systemPrompt";
import { AgentState } from "@/agent/types";

export async function loadContextNode(state: AgentState): Promise<Partial<AgentState>> {
    const [memories, recentMessages] = await Promise.all([
        memoryRepo.getMemoriesByUser(state.userId),
        messageRepo.getRecentHistory(state.userId, 10),
    ]);

    return {
        systemPrompt: buildSystemPrompt(),
        memoryContext: buildMemoryPrompt(memories),
        history: buildHistoryMessages(recentMessages),
    };
}
