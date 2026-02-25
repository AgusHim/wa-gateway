import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { configRepo } from "@/lib/db/configRepo";
import { loadAllInstructions } from "@/lib/instructions/loader";
import { executeTool, getToolDeclarations, ToolContext } from "@/agent/tools/registry";
import { loadContextNode } from "@/agent/nodes/loadContext";
import { AgentState } from "@/agent/types";

const DEFAULT_FALLBACK_RESPONSE = "Hmm, sepertinya aku butuh waktu lebih lama untuk memproses ini. Coba tanya lagi ya! 😊";
const LLM_ERROR_FALLBACK_RESPONSE = "Maaf, terjadi kesalahan saat memproses pesan kamu. Coba lagi nanti ya 🙏";
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const RECOVERY_RESPONSE = "Halo! Aku siap bantu. Coba kirim pertanyaanmu lagi dengan sedikit detail ya.";
const TOOL_ACK_PREFIX_PATTERNS = [
    /^\s*(oke|ok|baik)[,!\s-]*(aku|saya)\s*(udah|sudah)\s*cek(?:[^.\n]*?)?[,:.\-]?\s*/i,
    /^\s*(aku|saya)\s*(udah|sudah)\s*cek(?:[^.\n]*?)?[,:.\-]?\s*/i,
    /^\s*(udah|sudah)\s*(aku|saya)\s*cek(?:[^.\n]*?)?[,:.\-]?\s*/i,
];

type ToolDeclaration = ReturnType<typeof getToolDeclarations>[number];

const AgentStateAnnotation = Annotation.Root({
    userId: Annotation<string>,
    phoneNumber: Annotation<string>,
    incomingMessage: Annotation<string>,
    pushName: Annotation<string | undefined>,

    systemPrompt: Annotation<string>({ value: (_, b) => b, default: () => "" }),
    memoryContext: Annotation<string>({ value: (_, b) => b, default: () => "" }),
    history: Annotation<Array<{ role: "user" | "assistant"; content: string }>>({ value: (_, b) => b, default: () => [] }),

    toolMessages: Annotation<BaseMessage[]>({ value: (_, b) => b, default: () => [] }),
    pendingToolCalls: Annotation<Array<{ id?: string; name: string; args: Record<string, unknown> }>>({ value: (_, b) => b, default: () => [] }),

    iterationCount: Annotation<number>({ value: (_, b) => b, default: () => 0 }),
    maxIterations: Annotation<number>({ value: (_, b) => b, default: () => 5 }),
    shouldCallTool: Annotation<boolean>({ value: (_, b) => b, default: () => false }),

    draftResponse: Annotation<string>({ value: (_, b) => b, default: () => "" }),
    finalResponse: Annotation<string>({ value: (_, b) => b, default: () => "" }),
    lastError: Annotation<string>({ value: (_, b) => b, default: () => "" }),
});

function buildLLM(model: string) {
    return new ChatGoogleGenerativeAI({
        model,
        maxOutputTokens: 1024,
        apiKey: process.env.GOOGLE_API_KEY,
    });
}

async function createLLM() {
    const config = await configRepo.getBotConfig();
    return {
        llm: new ChatGoogleGenerativeAI({
            model: config.model,
            maxOutputTokens: config.maxTokens,
            apiKey: process.env.GOOGLE_API_KEY,
        }),
        model: config.model,
    };
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

function normalizeResponseText(raw: string): string {
    const cleaned = raw.trim().replace(/```/g, "");
    if (!cleaned) return "";

    const fallbackPattern = new RegExp(`(?:${escapeRegExp(LLM_ERROR_FALLBACK_RESPONSE)}){2,}`, "g");
    const collapsed = cleaned.replace(fallbackPattern, LLM_ERROR_FALLBACK_RESPONSE);

    // If response still contains repeated fallback chunks with partial tail, force single fallback text.
    if (collapsed.startsWith(LLM_ERROR_FALLBACK_RESPONSE) && collapsed !== LLM_ERROR_FALLBACK_RESPONSE) {
        return LLM_ERROR_FALLBACK_RESPONSE;
    }

    return collapsed;
}

function removeToolAckPrefix(raw: string, toolUsed: boolean): string {
    if (!toolUsed) return raw;

    let output = raw;
    for (const pattern of TOOL_ACK_PREFIX_PATTERNS) {
        output = output.replace(pattern, "");
    }

    const cleaned = output.trimStart();
    return cleaned || "Berikut hasilnya:";
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.stack ?? `${error.name}: ${error.message}`;
    }
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

async function invokeLLM(
    llm: ChatGoogleGenerativeAI,
    messages: BaseMessage[],
    toolDeclarations: ToolDeclaration[],
    withTools: boolean
) {
    if (withTools && toolDeclarations.length > 0) {
        return llm.bindTools(toolDeclarations).invoke(messages);
    }
    return llm.invoke(messages);
}

async function reasonNode(state: AgentState): Promise<Partial<AgentState>> {
    const primary = await createLLM();
    const messages = buildMessages(state);
    const toolDeclarations = getToolDeclarations();
    const errors: string[] = [];
    let response: AIMessage | undefined;

    try {
        response = await invokeLLM(primary.llm, messages, toolDeclarations, toolDeclarations.length > 0);
    } catch (error) {
        const formatted = formatError(error);
        errors.push(`primary(model=${primary.model}, withTools=true): ${formatted}`);
        console.error(`[Agent] Primary LLM call failed: ${formatted}`);
    }

    if (!response && toolDeclarations.length > 0) {
        try {
            response = await invokeLLM(primary.llm, messages, toolDeclarations, false);
            console.warn(`[Agent] Retry without tools succeeded on model=${primary.model}`);
        } catch (error) {
            const formatted = formatError(error);
            errors.push(`primary(model=${primary.model}, withTools=false): ${formatted}`);
            console.error(`[Agent] Retry without tools failed: ${formatted}`);
        }
    }

    if (!response && primary.model !== DEFAULT_MODEL) {
        try {
            const fallbackModelLLM = buildLLM(DEFAULT_MODEL);
            response = await invokeLLM(fallbackModelLLM, messages, toolDeclarations, false);
            console.warn(`[Agent] Fallback model without tools succeeded: ${DEFAULT_MODEL}`);
        } catch (error) {
            const formatted = formatError(error);
            errors.push(`fallback(model=${DEFAULT_MODEL}, withTools=false): ${formatted}`);
            console.error(`[Agent] Fallback model call failed: ${formatted}`);
        }
    }

    if (!response) {
        return {
            shouldCallTool: false,
            pendingToolCalls: [],
            draftResponse: LLM_ERROR_FALLBACK_RESPONSE,
            lastError: errors.join(" | "),
        };
    }

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
            lastError: "",
        };
    }

    return {
        shouldCallTool: false,
        pendingToolCalls: [],
        draftResponse: parseResponseText(response.content),
        lastError: "",
    };
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
    const normalized = normalizeResponseText(state.draftResponse);
    const cleaned = removeToolAckPrefix(normalized, state.toolMessages.length > 0);

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
    console.log(
        `[Agent] invokeAgentGraph userId=${input.userId} phone=${input.phoneNumber} incoming="${input.incomingMessage.slice(0, 160)}"`
    );

    const state = await agentApp.invoke({
        userId: input.userId,
        phoneNumber: input.phoneNumber,
        incomingMessage: input.incomingMessage,
        pushName: input.pushName,
        maxIterations: input.maxIterations ?? 5,
    });

    let finalResponse = state.finalResponse || DEFAULT_FALLBACK_RESPONSE;
    if (!state.lastError && finalResponse.includes(LLM_ERROR_FALLBACK_RESPONSE)) {
        console.warn(
            `[Agent] Model returned fallback-like text without captured error for ${input.phoneNumber}. Using recovery response.`
        );
        finalResponse = RECOVERY_RESPONSE;
    }
    if (state.lastError) {
        console.error(
            `[Agent] Fallback response returned for ${input.phoneNumber}. Incoming: ${input.incomingMessage.slice(0, 160)}`
        );
        console.error(`[Agent] Root cause: ${state.lastError}`);
    } else if (finalResponse === LLM_ERROR_FALLBACK_RESPONSE) {
        console.error(
            `[Agent] LLM error fallback used for ${input.phoneNumber}, but root cause was not captured in state.`
        );
    }
    console.log(`[Agent] finalResponse for ${input.phoneNumber}: "${finalResponse.slice(0, 200)}"`);
    return finalResponse;
}

async function extractAndSaveMemory(userId: string, userMessage: string): Promise<void> {
    try {
        const instructions = loadAllInstructions();
        const { llm } = await createLLM();

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
