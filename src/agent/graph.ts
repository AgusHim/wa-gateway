import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ToolMessage, HumanMessage, AIMessage, SystemMessage, BaseMessage } from "@langchain/core/messages";
import { buildSystemPrompt } from "./prompts/systemPrompt";
import { buildMemoryPrompt } from "./prompts/memoryPrompt";
import { buildHistoryMessages } from "./prompts/historyPrompt";
import { getToolDeclarations, executeTool, ToolContext } from "./tools/registry";
import { loadAllInstructions } from "../lib/instructions/loader";
import { userRepo } from "../lib/db/userRepo";
import { messageRepo } from "../lib/db/messageRepo";
import { memoryRepo } from "../lib/db/memoryRepo";
import { configRepo } from "../lib/db/configRepo";
import { Memory, Message } from "@prisma/client";

const MAX_TOOL_ITERATIONS = 5;

/**
 * Create a Gemini LLM instance with current BotConfig settings.
 */
async function createLLM() {
    const config = await configRepo.getBotConfig();
    return new ChatGoogleGenerativeAI({
        model: config.model,
        maxOutputTokens: config.maxTokens,
        apiKey: process.env.GOOGLE_API_KEY,
    });
}

/**
 * Build the full message array for the LLM call.
 */
function buildMessages(
    systemPrompt: string,
    memoryContext: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    incomingMessage: string,
    toolMessages: BaseMessage[]
): BaseMessage[] {
    const messages: BaseMessage[] = [
        new SystemMessage(`${systemPrompt}\n\n---\n${memoryContext}`),
    ];

    // Add chat history
    for (const msg of history) {
        if (msg.role === "user") {
            messages.push(new HumanMessage(msg.content));
        } else {
            messages.push(new AIMessage(msg.content));
        }
    }

    // Add current incoming message
    messages.push(new HumanMessage(incomingMessage));

    // Add any tool call/response messages from the agentic loop
    messages.push(...toolMessages);

    return messages;
}

/**
 * Run the AI agent for an incoming WhatsApp message.
 * This is the main entry point — handles the full agentic loop.
 */
export async function runAgent(
    phoneNumber: string,
    incomingMessage: string,
    pushName?: string
): Promise<string> {
    // 1. Check if bot is active
    const config = await configRepo.getBotConfig();
    if (!config.isActive) {
        return "Maaf, bot sedang tidak aktif. Silakan coba lagi nanti.";
    }

    // 2. Upsert user
    const user = await userRepo.upsertUser(phoneNumber, pushName);

    // Check if user is blocked
    if (user.isBlocked) {
        return ""; // Silently ignore blocked users
    }

    // 3. Save incoming message to DB
    await messageRepo.saveMessage({
        userId: user.id,
        role: "user",
        content: incomingMessage,
    });

    // 4. Load context
    const memories: Memory[] = await memoryRepo.getMemoriesByUser(user.id);
    const recentMessages: Message[] = await messageRepo.getRecentHistory(user.id, 10);

    const systemPrompt = buildSystemPrompt();
    const memoryContext = buildMemoryPrompt(memories);
    const history = buildHistoryMessages(recentMessages);

    // 5. Create LLM
    const llm = await createLLM();

    // 6. Get tool declarations
    const toolDeclarations = getToolDeclarations();
    const toolContext: ToolContext = {
        userId: user.id,
        phoneNumber,
    };

    // 7. Agentic loop
    const toolMessages: BaseMessage[] = [];
    let finalResponse = "";

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const messages = buildMessages(
            systemPrompt,
            memoryContext,
            history,
            incomingMessage,
            toolMessages
        );

        // Call LLM
        let response;
        try {
            if (toolDeclarations.length > 0) {
                const llmWithTools = llm.bindTools(toolDeclarations);
                response = await llmWithTools.invoke(messages);
            } else {
                response = await llm.invoke(messages);
            }
        } catch (error) {
            console.error("[Agent] LLM call failed:", error);
            finalResponse = "Maaf, terjadi kesalahan saat memproses pesan kamu. Coba lagi nanti ya 🙏";
            break;
        }

        // Check for tool calls
        const toolCalls = response.tool_calls;

        if (toolCalls && toolCalls.length > 0) {
            // Add the AI message with tool calls
            toolMessages.push(response);

            // Execute each tool call
            for (const toolCall of toolCalls) {
                console.log(`[Agent] Tool call: ${toolCall.name}(${JSON.stringify(toolCall.args)})`);

                const toolResult = await executeTool(
                    toolCall.name,
                    toolCall.args as Record<string, string>,
                    toolContext
                );

                toolMessages.push(
                    new ToolMessage({
                        content: toolResult,
                        tool_call_id: toolCall.id ?? toolCall.name,
                    })
                );
            }

            // Continue the loop — LLM will process tool results
            continue;
        }

        // No tool calls — we have a final response
        finalResponse = typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);
        break;
    }

    // 8. Fallback if no response generated
    if (!finalResponse) {
        finalResponse = "Hmm, sepertinya aku butuh waktu lebih lama untuk memproses ini. Coba tanya lagi ya! 😊";
    }

    // 9. Save assistant response to DB
    await messageRepo.saveMessage({
        userId: user.id,
        role: "assistant",
        content: finalResponse,
    });

    // 10. Memory extraction (async, non-blocking)
    extractAndSaveMemory(user.id, incomingMessage).catch(console.error);

    return finalResponse;
}

/**
 * Extract facts from the user message and save to long-term memory.
 * This runs asynchronously after the response is sent.
 */
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

        // Parse JSON from response
        const jsonMatch = content.match(/\[[\s\S]*?\]/);
        if (!jsonMatch) return;

        const facts = JSON.parse(jsonMatch[0]) as Array<{ key: string; value: string }>;

        for (const fact of facts) {
            if (fact.key && fact.value) {
                await memoryRepo.upsertMemory({
                    userId,
                    key: fact.key,
                    value: fact.value,
                });
                console.log(`[Memory] Saved: ${fact.key} = ${fact.value}`);
            }
        }
    } catch {
        // Memory extraction is best-effort, don't fail the main flow
    }
}
