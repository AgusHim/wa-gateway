import { loadAllInstructions } from "../../lib/instructions/loader";

export type PromptSections = {
    identity?: string;
    behavior?: string;
    skills?: string;
};

/**
 * Build the system prompt by combining Identity + Behavior + Skills instruction files.
 */
export function buildSystemPrompt(sections?: PromptSections): string {
    const instructions = loadAllInstructions();
    const identity = sections?.identity?.trim() || instructions.identity;
    const behavior = sections?.behavior?.trim() || instructions.behavior;
    const skills = sections?.skills?.trim() || instructions.skills;

    return `${identity}

${behavior}

${skills}

---
PENTING: Kamu adalah Customer Service. Jangan gunakan markdown formatting yang berat.
Gunakan bahasa Indonesia yang natural dan ramah.
`.trim();
}
