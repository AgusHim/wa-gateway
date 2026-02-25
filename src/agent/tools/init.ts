import { registerTool } from "./registry";
import { getUserInfoTool, saveNoteTool } from "./builtinTools";

/**
 * Initialize all built-in tools. Call this once at app startup.
 */
export function initializeTools(): void {
    registerTool(getUserInfoTool);
    registerTool(saveNoteTool);

    console.log("[Tools] All built-in tools initialized");
}
