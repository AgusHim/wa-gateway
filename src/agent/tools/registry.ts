/**
 * Tool interface — all tools must implement this.
 */
import { TenantRole, UsageMetric } from "@prisma/client";
import { CircuitBreakerOpenError, executeWithCircuitBreaker } from "../../lib/resilience/circuitBreaker";
import { logWarn } from "../../lib/observability/logger";

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
    workspaceId: string;
    userId: string;
    channelId?: string;
    phoneNumber: string;
    actorRole?: TenantRole;
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
        type: "function" as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
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

    if (process.env.NODE_ENV !== "test") {
        const { workspaceToolPolicyRepo } = await import("@/lib/db/workspaceToolPolicyRepo");
        const actorRole = context.actorRole ?? TenantRole.OPERATOR;
        const policy = await workspaceToolPolicyRepo.evaluatePolicy(context.workspaceId, name, actorRole);

        if (!policy.allowed) {
            if (!policy.isEnabled) {
                return `Tool "${name}" sedang dinonaktifkan untuk workspace ini.`;
            }

            return `Role ${actorRole} tidak memiliki akses untuk tool "${name}".`;
        }
    }

    if (process.env.NODE_ENV !== "test") {
        const { billingService } = await import("../../lib/billing/service");
        const toolQuota = await billingService.consumeUsage({
            workspaceId: context.workspaceId,
            channelId: context.channelId,
            metric: UsageMetric.TOOL_CALL,
            quantity: 1,
            referenceId: context.userId,
            metadata: {
                toolName: name,
                phase: "pre-execution",
                actorRole: context.actorRole ?? TenantRole.OPERATOR,
            },
        });

        if (!toolQuota.allowed) {
            return "Batas pemakaian tool untuk paket saat ini sudah habis. Silakan upgrade plan.";
        }
    }

    const startTime = Date.now();
    let result: string;
    let success = true;

    try {
        result = await executeWithCircuitBreaker(
            `tool:${context.workspaceId}:${name}`,
            async () => tool.execute(params, context),
            {
                failureThreshold: 3,
                resetTimeoutMs: 20_000,
                successThreshold: 1,
            }
        );
    } catch (error) {
        success = false;
        if (error instanceof CircuitBreakerOpenError) {
            result = `Tool "${name}" sedang cooldown karena gagal berulang. Coba lagi dalam ${Math.ceil(error.retryAfterMs / 1000)} detik.`;
            logWarn("tool.execution.blocked_by_circuit_breaker", {
                workspaceId: context.workspaceId,
                toolName: name,
                retryAfterMs: error.retryAfterMs,
            });
        } else {
            const message = error instanceof Error ? error.message : "Unknown error";
            result = `Error executing tool "${name}": ${message}`;

            if (process.env.NODE_ENV !== "test") {
                import("@/lib/integrations/webhookService")
                    .then(({ webhookService }) => webhookService.enqueueEvent({
                        workspaceId: context.workspaceId,
                        eventType: "TOOL_FAILED",
                        payload: {
                            toolName: name,
                            userId: context.userId,
                            phoneNumber: context.phoneNumber,
                            channelId: context.channelId || null,
                            actorRole: context.actorRole || null,
                            input: params,
                            error: message,
                        },
                    }))
                    .catch(console.error);
            }
        }
    }

    const duration = Date.now() - startTime;

    // Log to database (fire-and-forget, lazy import to keep tests decoupled from Prisma init)
    if (process.env.NODE_ENV !== "test") {
        import("../../lib/db/toolLogRepo")
            .then(({ toolLogRepo }) => toolLogRepo.saveToolLog({
                    workspaceId: context.workspaceId,
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
