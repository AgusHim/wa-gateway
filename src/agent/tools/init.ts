import { registerTool } from "./registry";
import {
    crmSyncContactTool,
    fetchSmartScholarEndpointTool,
    getUserInfoTool,
    saveNoteTool,
    searchKnowledgeTool,
    webhookActionTool,
} from "./builtinTools";

/**
 * Initialize all built-in tools. Call this once at app startup.
 */
export function initializeTools(): void {
    registerTool(getUserInfoTool);
    registerTool(saveNoteTool);
    registerTool(fetchSmartScholarEndpointTool);
    registerTool(webhookActionTool);
    registerTool(crmSyncContactTool);
    registerTool(searchKnowledgeTool);

    console.log("[Tools] All built-in tools initialized");
}
