import { registerTool } from "./registry";
import { fetchSmartScholarEndpointTool, getUserInfoTool, saveNoteTool } from "./builtinTools";

/**
 * Initialize all built-in tools. Call this once at app startup.
 */
export function initializeTools(): void {
    registerTool(getUserInfoTool);
    registerTool(saveNoteTool);
    registerTool(fetchSmartScholarEndpointTool);

    console.log("[Tools] All built-in tools initialized");
}
