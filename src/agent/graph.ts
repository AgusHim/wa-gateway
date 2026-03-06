import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { TenantRole } from "@prisma/client";
import { configRepo } from "@/lib/db/configRepo";
import { loadAllInstructions } from "@/lib/instructions/loader";
import { workspacePromptRepo } from "@/lib/db/workspacePromptRepo";
import { executeTool, getToolDeclarations, ToolContext } from "@/agent/tools/registry";
import { loadContextNode } from "@/agent/nodes/loadContext";
import { AgentState } from "@/agent/types";
import { executeWithCircuitBreaker } from "@/lib/resilience/circuitBreaker";

const DEFAULT_FALLBACK_RESPONSE = "Hmm, sepertinya aku butuh waktu lebih lama untuk memproses ini. Coba tanya lagi ya! 😊";
const LLM_ERROR_FALLBACK_RESPONSE = "Sebentar, chat kamu akan saya balas 🙏";
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const RECOVERY_RESPONSE = "Halo! Aku siap bantu. Coba kirim pertanyaanmu lagi dengan sedikit detail ya.";
const TOOL_ACK_PREFIX_PATTERNS = [
    /^\s*(oke|ok|baik)[,!\s-]*(aku|saya)\s*(udah|sudah)\s*cek(?:[^.\n]*?)?[,:.\-]?\s*/i,
    /^\s*(aku|saya)\s*(udah|sudah)\s*cek(?:[^.\n]*?)?[,:.\-]?\s*/i,
    /^\s*(udah|sudah)\s*(aku|saya)\s*cek(?:[^.\n]*?)?[,:.\-]?\s*/i,
];

type ToolDeclaration = ReturnType<typeof getToolDeclarations>[number];

const AgentStateAnnotation = Annotation.Root({
    workspaceId: Annotation<string>,
    userId: Annotation<string>,
    channelId: Annotation<string | undefined>({ value: (_, b) => b, default: () => undefined }),
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
    responseModel: Annotation<string>({ value: (_, b) => b, default: () => "" }),
    inputTokens: Annotation<number>({ value: (_, b) => b, default: () => 0 }),
    outputTokens: Annotation<number>({ value: (_, b) => b, default: () => 0 }),
    totalTokens: Annotation<number>({ value: (_, b) => b, default: () => 0 }),
    lastError: Annotation<string>({ value: (_, b) => b, default: () => "" }),
});

function resolveTemperature(baseTemperature: number, safetyProfile: string): number {
    const normalized = safetyProfile.trim().toLowerCase();
    if (normalized === "strict") {
        return Math.max(0, Math.min(1, Math.min(baseTemperature, 0.2)));
    }
    if (normalized === "relaxed") {
        return Math.max(0, Math.min(1, Math.max(baseTemperature, 0.7)));
    }
    return Math.max(0, Math.min(1, baseTemperature));
}

type WorkspaceModelConfig = {
    primaryModel: string;
    fallbackModels: string[];
    maxTokens: number;
    temperature: number;
    safetyProfile: string;
};

type LlmClient = {
    invoke: (messages: BaseMessage[]) => Promise<AIMessage>;
    bindTools: (toolDeclarations: ToolDeclaration[]) => {
        invoke: (messages: BaseMessage[]) => Promise<AIMessage>;
    };
};

const DEFAULT_GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_API_BASE_URL = (process.env.GROQ_API_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");

type GroqChatMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_call_id?: string;
    tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
            name: string;
            arguments: string;
        };
    }>;
};

type GroqChatCompletionResponse = {
    choices?: Array<{
        message?: {
            content?: string | null;
            tool_calls?: Array<{
                id?: string;
                type?: string;
                function?: {
                    name?: string;
                    arguments?: string;
                };
            }>;
        };
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
};

function resolveGroqModel(requestedModel: string): string {
    const candidate = requestedModel.trim();
    if (!candidate || candidate.toLowerCase().startsWith("gemini")) {
        return DEFAULT_GROQ_MODEL;
    }
    return candidate;
}

function toGroqMessages(messages: BaseMessage[]): GroqChatMessage[] {
    const output: GroqChatMessage[] = [];

    for (const message of messages) {
        if (message instanceof SystemMessage) {
            output.push({
                role: "system",
                content: parseResponseText(message.content) || "",
            });
            continue;
        }

        if (message instanceof HumanMessage) {
            output.push({
                role: "user",
                content: parseResponseText(message.content) || "",
            });
            continue;
        }

        if (message instanceof ToolMessage) {
            const toolCallId = (message as unknown as { tool_call_id?: string }).tool_call_id;
            output.push({
                role: "tool",
                content: parseResponseText(message.content) || "",
                tool_call_id: toolCallId,
            });
            continue;
        }

        if (message instanceof AIMessage) {
            const toolCalls = (message.tool_calls ?? []).map((item) => ({
                id: item.id || item.name,
                type: "function" as const,
                function: {
                    name: item.name,
                    arguments: JSON.stringify(item.args ?? {}),
                },
            }));

            output.push({
                role: "assistant",
                content: parseResponseText(message.content) || null,
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            });
            continue;
        }

        output.push({
            role: "user",
            content: parseResponseText(message.content) || "",
        });
    }

    return output;
}

class GroqChatAdapter implements LlmClient {
    private readonly model: string;
    private readonly maxTokens: number;
    private readonly temperature: number;
    private readonly apiKey: string;
    private readonly toolDeclarations: ToolDeclaration[];

    constructor(input: {
        model: string;
        maxTokens: number;
        temperature: number;
        apiKey: string;
        toolDeclarations?: ToolDeclaration[];
    }) {
        this.model = resolveGroqModel(input.model);
        this.maxTokens = input.maxTokens;
        this.temperature = input.temperature;
        this.apiKey = input.apiKey;
        this.toolDeclarations = input.toolDeclarations ?? [];
    }

    bindTools(toolDeclarations: ToolDeclaration[]) {
        const next = new GroqChatAdapter({
            model: this.model,
            maxTokens: this.maxTokens,
            temperature: this.temperature,
            apiKey: this.apiKey,
            toolDeclarations,
        });

        return {
            invoke: (messages: BaseMessage[]) => next.invoke(messages),
        };
    }

    async invoke(messages: BaseMessage[]): Promise<AIMessage> {
        const response = await fetch(`${GROQ_API_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                temperature: this.temperature,
                max_tokens: this.maxTokens,
                messages: toGroqMessages(messages),
                tools: this.toolDeclarations.length > 0 ? this.toolDeclarations : undefined,
                tool_choice: this.toolDeclarations.length > 0 ? "auto" : undefined,
            }),
        });

        if (!response.ok) {
            const body = (await response.text()).slice(0, 2000);
            throw new Error(`GROQ HTTP ${response.status}: ${body}`);
        }

        const payload = await response.json() as GroqChatCompletionResponse;
        const message = payload.choices?.[0]?.message;
        const rawToolCalls = message?.tool_calls ?? [];
        const toolCalls = rawToolCalls
            .filter((item) => item.type === "function" && item.function?.name)
            .map((item) => {
                let args: Record<string, unknown> = {};
                const rawArgs = item.function?.arguments || "{}";
                try {
                    const parsed = JSON.parse(rawArgs);
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                        args = parsed as Record<string, unknown>;
                    }
                } catch {
                    args = {};
                }

                return {
                    id: item.id || item.function?.name || "tool_call",
                    name: item.function?.name || "tool",
                    args,
                };
            });

        return new AIMessage({
            content: message?.content || "",
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            response_metadata: {
                usage: payload.usage || {},
            },
        });
    }
}

async function loadWorkspaceModelConfig(workspaceId: string): Promise<WorkspaceModelConfig> {
    const config = await configRepo.getBotConfig(workspaceId);
    const fallbackModels = Array.isArray(config.fallbackModels)
        ? config.fallbackModels
            .map((item) => item.trim())
            .filter((item): item is string => Boolean(item))
            .filter((item) => item !== config.model)
        : [];

    return {
        primaryModel: config.model,
        fallbackModels,
        maxTokens: config.maxTokens,
        temperature: resolveTemperature(config.temperature, config.safetyProfile),
        safetyProfile: config.safetyProfile,
    };
}

function createConfiguredLlm(model: string, config: WorkspaceModelConfig): LlmClient {
    const shouldUseGroqInDev = process.env.NODE_ENV === "development" && Boolean(process.env.GROQ_API_KEY);
    if (shouldUseGroqInDev) {
        return new GroqChatAdapter({
            model: "llama-3.1-8b-instant",
            maxTokens: config.maxTokens,
            temperature: config.temperature,
            apiKey: String(process.env.GROQ_API_KEY),
        });
    }

    return new ChatGoogleGenerativeAI({
        model,
        maxOutputTokens: config.maxTokens,
        temperature: config.temperature,
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

function readNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractUsageMetadata(response: AIMessage) {
    const usageDirect = (response as unknown as { usage_metadata?: Record<string, unknown> }).usage_metadata;
    const usageFromMetadata = (response as unknown as { response_metadata?: Record<string, unknown> }).response_metadata;
    const usageNested = usageFromMetadata
        ? (usageFromMetadata.usage as Record<string, unknown> | undefined)
            || (usageFromMetadata.usageMetadata as Record<string, unknown> | undefined)
            || (usageFromMetadata.tokenUsage as Record<string, unknown> | undefined)
        : undefined;

    const usage = usageDirect || usageNested || {};
    const inputTokens = readNumber(usage.input_tokens)
        ?? readNumber(usage.inputTokens)
        ?? readNumber(usage.prompt_tokens)
        ?? readNumber(usage.promptTokens)
        ?? 0;
    const outputTokens = readNumber(usage.output_tokens)
        ?? readNumber(usage.outputTokens)
        ?? readNumber(usage.completion_tokens)
        ?? readNumber(usage.completionTokens)
        ?? 0;
    const totalTokens = readNumber(usage.total_tokens)
        ?? readNumber(usage.totalTokens)
        ?? (inputTokens + outputTokens);

    return {
        inputTokens,
        outputTokens,
        totalTokens,
    };
}

async function invokeLLM(
    llm: LlmClient,
    messages: BaseMessage[],
    toolDeclarations: ToolDeclaration[],
    withTools: boolean,
    circuitKey: string
) {
    return executeWithCircuitBreaker(circuitKey, async () => {
        if (withTools && toolDeclarations.length > 0) {
            return llm.bindTools(toolDeclarations).invoke(messages);
        }
        return llm.invoke(messages);
    }, {
        failureThreshold: 4,
        resetTimeoutMs: 30_000,
        successThreshold: 1,
    });
}

async function reasonNode(state: AgentState): Promise<Partial<AgentState>> {
    const modelConfig = await loadWorkspaceModelConfig(state.workspaceId);
    const primaryLlm = createConfiguredLlm(modelConfig.primaryModel, modelConfig);
    const messages = buildMessages(state);
    const toolDeclarations = getToolDeclarations();
    const errors: string[] = [];
    let response: AIMessage | undefined;
    let usedModel = modelConfig.primaryModel;

    try {
        response = await invokeLLM(
            primaryLlm,
            messages,
            toolDeclarations,
            toolDeclarations.length > 0,
            `ai:${state.workspaceId}:${modelConfig.primaryModel}`
        );
        usedModel = modelConfig.primaryModel;
    } catch (error) {
        const formatted = formatError(error);
        errors.push(`primary(model=${modelConfig.primaryModel}, withTools=true): ${formatted}`);
        console.error(`[Agent] Primary LLM call failed: ${formatted}`);
    }

    if (!response && toolDeclarations.length > 0) {
        try {
            response = await invokeLLM(
                primaryLlm,
                messages,
                toolDeclarations,
                false,
                `ai:${state.workspaceId}:${modelConfig.primaryModel}`
            );
            usedModel = modelConfig.primaryModel;
            console.warn(`[Agent] Retry without tools succeeded on model=${modelConfig.primaryModel}`);
        } catch (error) {
            const formatted = formatError(error);
            errors.push(`primary(model=${modelConfig.primaryModel}, withTools=false): ${formatted}`);
            console.error(`[Agent] Retry without tools failed: ${formatted}`);
        }
    }

    const fallbackModels = [...modelConfig.fallbackModels];
    if (!fallbackModels.includes(DEFAULT_MODEL) && DEFAULT_MODEL !== modelConfig.primaryModel) {
        fallbackModels.push(DEFAULT_MODEL);
    }

    for (const fallbackModel of fallbackModels) {
        if (response) {
            break;
        }

        try {
            const fallbackLlm = createConfiguredLlm(fallbackModel, modelConfig);
            response = await invokeLLM(
                fallbackLlm,
                messages,
                toolDeclarations,
                false,
                `ai:${state.workspaceId}:${fallbackModel}`
            );
            usedModel = fallbackModel;
            console.warn(`[Agent] Fallback model without tools succeeded: ${fallbackModel}`);
        } catch (error) {
            const formatted = formatError(error);
            errors.push(`fallback(model=${fallbackModel}, withTools=false): ${formatted}`);
            console.error(`[Agent] Fallback model call failed: ${formatted}`);
        }
    }

    if (!response) {
        return {
            shouldCallTool: false,
            pendingToolCalls: [],
            draftResponse: LLM_ERROR_FALLBACK_RESPONSE,
            responseModel: modelConfig.primaryModel,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            lastError: errors.join(" | "),
        };
    }

    const usage = extractUsageMetadata(response);
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
            responseModel: usedModel,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            lastError: "",
        };
    }

    return {
        shouldCallTool: false,
        pendingToolCalls: [],
        draftResponse: parseResponseText(response.content),
        responseModel: usedModel,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
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
        workspaceId: state.workspaceId,
        userId: state.userId,
        channelId: state.channelId,
        phoneNumber: state.phoneNumber,
        actorRole: TenantRole.OPERATOR,
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
    extractAndSaveMemory(state.workspaceId, state.userId, state.incomingMessage, state.channelId).catch(console.error);
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

export type AgentGraphResult = {
    response: string;
    metadata: {
        model: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        iterations: number;
        lastError?: string;
    };
};

export async function invokeAgentGraphDetailed(input: {
    workspaceId: string;
    userId: string;
    channelId?: string;
    phoneNumber: string;
    incomingMessage: string;
    pushName?: string;
    maxIterations?: number;
}): Promise<AgentGraphResult> {
    console.log(
        `[Agent] invokeAgentGraph workspaceId=${input.workspaceId} userId=${input.userId} phone=${input.phoneNumber} incoming="${input.incomingMessage.slice(0, 160)}"`
    );

    const state = await agentApp.invoke({
        workspaceId: input.workspaceId,
        userId: input.userId,
        channelId: input.channelId,
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
    return {
        response: finalResponse,
        metadata: {
            model: state.responseModel || DEFAULT_MODEL,
            inputTokens: state.inputTokens || 0,
            outputTokens: state.outputTokens || 0,
            totalTokens: state.totalTokens || 0,
            iterations: state.iterationCount || 0,
            lastError: state.lastError || undefined,
        },
    };
}

export async function invokeAgentGraph(input: {
    workspaceId: string;
    userId: string;
    channelId?: string;
    phoneNumber: string;
    incomingMessage: string;
    pushName?: string;
    maxIterations?: number;
}): Promise<string> {
    const result = await invokeAgentGraphDetailed(input);
    return result.response;
}

async function extractAndSaveMemory(
    workspaceId: string,
    userId: string,
    userMessage: string,
    channelId?: string
): Promise<void> {
    try {
        const instructions = loadAllInstructions();
        const prompt = await workspacePromptRepo.getActivePromptVersion(workspaceId);
        const llmConfig = await loadWorkspaceModelConfig(workspaceId);
        const llm = createConfiguredLlm(llmConfig.primaryModel, llmConfig);
        const memoryInstruction = prompt?.memory?.trim() || instructions.memory;

        const extractionPrompt = `${memoryInstruction}

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
                    workspaceId,
                    userId,
                    channelId,
                    key: fact.key,
                    value: fact.value,
                });
            }
        }
    } catch {
        // best-effort only
    }
}
