/**
 * Tool interface — all tools must implement this.
 */
export interface Tool {
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, { type: string; description: string }>;
        required: string[];
    };
    execute: (params: Record<string, string>, context: ToolContext) => Promise<string>;
}

export interface ToolContext {
    userId: string;
    phoneNumber: string;
}

// Tool registry map
const tools: Map<string, Tool> = new Map();

/**
 * Register a tool in the registry.
 */
export function registerTool(tool: Tool): void {
    tools.set(tool.name, tool);
    console.log(`[Tools] Registered: ${tool.name}`);
}

/**
 * Get a tool by name.
 */
export function getTool(name: string): Tool | undefined {
    return tools.get(name);
}

/**
 * Get all registered tools.
 */
export function getAllTools(): Tool[] {
    return Array.from(tools.values());
}

export function clearTools(): void {
    tools.clear();
}

/**
 * Get tool declarations for Gemini function calling.
 */
export function getToolDeclarations() {
    return getAllTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
    }));
}

/**
 * Execute a tool by name, log the result.
 */
export async function executeTool(
    name: string,
    params: Record<string, string>,
    context: ToolContext
): Promise<string> {
    const tool = getTool(name);
    if (!tool) {
        return `Tool "${name}" not found.`;
    }

    const startTime = Date.now();
    let result: string;
    let success = true;

    try {
        result = await tool.execute(params, context);
    } catch (error) {
        success = false;
        result = `Error executing tool "${name}": ${error instanceof Error ? error.message : "Unknown error"}`;
    }

    const duration = Date.now() - startTime;

    // Log to database (fire-and-forget, lazy import to keep tests decoupled from Prisma init)
    if (process.env.NODE_ENV !== "test") {
        import("../../lib/db/toolLogRepo")
            .then(({ toolLogRepo }) => toolLogRepo.saveToolLog({
                toolName: name,
                input: params,
                output: { result },
                success,
                duration,
            }))
            .catch(console.error);
    }

    return result;
}
