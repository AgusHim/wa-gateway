import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { configRepo } from "@/lib/db/configRepo";
import { loadAllInstructions } from "@/lib/instructions/loader";
import { executeTool, getToolDeclarations, ToolContext } from "@/agent/tools/registry";
import { loadContextNode } from "@/agent/nodes/loadContext";
import { AgentState } from "@/agent/types";

const DEFAULT_FALLBACK_RESPONSE = "Hmm, sepertinya aku butuh waktu lebih lama untuk memproses ini. Coba tanya lagi ya! 😊";

const AgentStateAnnotation = Annotation.Root({
    userId: Annotation<string>,
    phoneNumber: Annotation<string>,
    incomingMessage: Annotation<string>,
    pushName: Annotation<string | undefined>,

    systemPrompt: Annotation<string>({ default: () => "" }),
    memoryContext: Annotation<string>({ default: () => "" }),
    history: Annotation<Array<{ role: "user" | "assistant"; content: string }>>({ default: () => [] }),

    toolMessages: Annotation<BaseMessage[]>({ default: () => [] }),
    pendingToolCalls: Annotation<Array<{ id?: string; name: string; args: Record<string, unknown> }>>({ default: () => [] }),

    iterationCount: Annotation<number>({ default: () => 0 }),
    maxIterations: Annotation<number>({ default: () => 5 }),
    shouldCallTool: Annotation<boolean>({ default: () => false }),

    draftResponse: Annotation<string>({ default: () => "" }),
    finalResponse: Annotation<string>({ default: () => "" }),
});

async function createLLM() {
    const config = await configRepo.getBotConfig();
    return new ChatGoogleGenerativeAI({
        model: config.model,
        maxOutputTokens: config.maxTokens,
        apiKey: process.env.GOOGLE_API_KEY,
    });
}

function buildMessages(state: AgentState): BaseMessage[] {
    const messages: BaseMessage[] = [
        new SystemMessage(`${state.systemPrompt}\n\n---\n${state.memoryContext}`),
    ];

    for (const msg of state.history) {
        messages.push(msg.role === "user" ? new HumanMessage(msg.content) : new AIMessage(msg.content));
    }

    messages.push(new HumanMessage(state.incomingMessage));
    messages.push(...state.toolMessages);

    return messages;
}

function parseResponseText(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }

    try {
        return JSON.stringify(content);
    } catch {
        return "";
    }
}

async function reasonNode(state: AgentState): Promise<Partial<AgentState>> {
    const llm = await createLLM();
    const messages = buildMessages(state);
    const toolDeclarations = getToolDeclarations();

    try {
        const response = toolDeclarations.length > 0
            ? await llm.bindTools(toolDeclarations).invoke(messages)
            : await llm.invoke(messages);

        const toolCalls = (response.tool_calls ?? []).map((call) => ({
            id: call.id,
            name: call.name,
            args: (call.args ?? {}) as Record<string, unknown>,
        }));

        if (toolCalls.length > 0 && state.iterationCount < state.maxIterations) {
            return {
                shouldCallTool: true,
                pendingToolCalls: toolCalls,
                toolMessages: [...state.toolMessages, response],
                iterationCount: state.iterationCount + 1,
                draftResponse: "",
            };
        }

        return {
            shouldCallTool: false,
            pendingToolCalls: [],
            draftResponse: parseResponseText(response.content),
        };
    } catch (error) {
        console.error("[Agent] LLM call failed:", error);
        return {
            shouldCallTool: false,
            pendingToolCalls: [],
            draftResponse: "Maaf, terjadi kesalahan saat memproses pesan kamu. Coba lagi nanti ya 🙏",
        };
    }
}

async function executeToolNode(state: AgentState): Promise<Partial<AgentState>> {
    if (!state.shouldCallTool || state.pendingToolCalls.length === 0) {
        return {
            shouldCallTool: false,
            pendingToolCalls: [],
        };
    }

    const toolContext: ToolContext = {
        userId: state.userId,
        phoneNumber: state.phoneNumber,
    };

    const additionalMessages: BaseMessage[] = [];

    for (const toolCall of state.pendingToolCalls) {
        const toolResult = await executeTool(
            toolCall.name,
            toolCall.args as Record<string, string>,
            toolContext
        );

        additionalMessages.push(
            new ToolMessage({
                content: toolResult,
                tool_call_id: toolCall.id ?? toolCall.name,
            })
        );
    }

    return {
        toolMessages: [...state.toolMessages, ...additionalMessages],
        shouldCallTool: false,
        pendingToolCalls: [],
    };
}

function formatResponseNode(state: AgentState): Partial<AgentState> {
    const cleaned = state.draftResponse.trim().replace(/```/g, "");

    return {
        finalResponse: cleaned || DEFAULT_FALLBACK_RESPONSE,
    };
}

async function updateMemoryNode(state: AgentState): Promise<Partial<AgentState>> {
    extractAndSaveMemory(state.userId, state.incomingMessage).catch(console.error);
    return {};
}

function routeAfterReason(state: AgentState): "execute_tool" | "format_response" {
    return state.shouldCallTool ? "execute_tool" : "format_response";
}

const workflow = new StateGraph(AgentStateAnnotation)
    .addNode("load_context", loadContextNode)
    .addNode("reason", reasonNode)
    .addNode("execute_tool", executeToolNode)
    .addNode("format_response", formatResponseNode)
    .addNode("update_memory", updateMemoryNode)
    .addEdge(START, "load_context")
    .addEdge("load_context", "reason")
    .addConditionalEdges("reason", routeAfterReason)
    .addEdge("execute_tool", "reason")
    .addEdge("format_response", "update_memory")
    .addEdge("update_memory", END);

export const agentApp = workflow.compile();

export async function invokeAgentGraph(input: {
    userId: string;
    phoneNumber: string;
    incomingMessage: string;
    pushName?: string;
    maxIterations?: number;
}): Promise<string> {
    const state = await agentApp.invoke({
        userId: input.userId,
        phoneNumber: input.phoneNumber,
        incomingMessage: input.incomingMessage,
        pushName: input.pushName,
        maxIterations: input.maxIterations ?? 5,
    });

    const finalResponse = state.finalResponse || DEFAULT_FALLBACK_RESPONSE;
    return finalResponse;
}

async function extractAndSaveMemory(userId: string, userMessage: string): Promise<void> {
    try {
        const instructions = loadAllInstructions();
        const llm = await createLLM();

        const extractionPrompt = `${instructions.memory}

Berdasarkan pesan user berikut, ekstrak fakta-fakta penting dalam format JSON array.
Jika tidak ada fakta yang bisa diekstrak, kembalikan array kosong [].

Pesan user: "${userMessage}"

Format output (JSON array only, tanpa markdown):
[{"key": "nama_fakta", "value": "nilai_fakta"}]`;

        const response = await llm.invoke([new SystemMessage(extractionPrompt)]);
        const content = typeof response.content === "string" ? response.content : "";

        const jsonMatch = content.match(/\[[\s\S]*?\]/);
        if (!jsonMatch) return;

        const facts = JSON.parse(jsonMatch[0]) as Array<{ key: string; value: string }>;

        const { memoryRepo } = await import("@/lib/db/memoryRepo");
        for (const fact of facts) {
            if (fact.key && fact.value) {
                await memoryRepo.upsertMemory({
                    userId,
                    key: fact.key,
                    value: fact.value,
                });
            }
        }
    } catch {
        // best-effort only
    }
}
