import { Memory } from "@prisma/client";

/**
 * Format user memories into a readable context string for the AI.
 */
export function buildMemoryPrompt(memories: Memory[]): string {
    if (!memories || memories.length === 0) {
        return "Belum ada informasi yang diketahui tentang user ini.";
    }

    const lines = memories.map((m) => `- ${m.key}: ${m.value}`);

    return `Informasi yang sudah diketahui tentang user ini:
${lines.join("\n")}

Gunakan informasi ini untuk memberikan respons yang lebih personal dan relevan.
Jangan tanya ulang informasi yang sudah kamu tahu.`.trim();
}
