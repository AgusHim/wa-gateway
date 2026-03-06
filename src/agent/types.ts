import { BaseMessage } from "@langchain/core/messages";

export type AgentToolCall = {
    id?: string;
    name: string;
    args: Record<string, unknown>;
};

export interface AgentState {
    workspaceId: string;
    userId: string;
    channelId?: string;
    phoneNumber: string;
    incomingMessage: string;
    pushName?: string;

    systemPrompt: string;
    memoryContext: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;

    toolMessages: BaseMessage[];
    pendingToolCalls: AgentToolCall[];

    iterationCount: number;
    maxIterations: number;
    shouldCallTool: boolean;

    draftResponse: string;
    finalResponse: string;
    responseModel: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    lastError: string;
}
