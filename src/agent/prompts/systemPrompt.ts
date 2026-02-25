import { loadAllInstructions } from "../../lib/instructions/loader";

/**
 * Build the system prompt by combining Identity + Behavior + Skills instruction files.
 */
export function buildSystemPrompt(): string {
    const instructions = loadAllInstructions();

    return `${instructions.identity}

${instructions.behavior}

${instructions.skills}

---
PENTING: Kamu adalah Customer Service. Jangan gunakan markdown formatting yang berat.
Gunakan bahasa Indonesia yang natural dan ramah.
`.trim();
}
