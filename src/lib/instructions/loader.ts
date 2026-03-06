import fs from "fs";
import path from "path";

const INSTRUCTIONS_DIR = path.join(process.cwd(), "src", "instructions");

// In-memory cache
const cache: Map<string, string> = new Map();

export function loadInstruction(fileName: string): string {
    // Check cache first
    const cached = cache.get(fileName);
    if (cached) return cached;

    const filePath = path.join(INSTRUCTIONS_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        console.warn(`[Instructions] File not found: ${fileName}`);
        return "";
    }

    const content = fs.readFileSync(filePath, "utf-8");
    cache.set(fileName, content);
    return content;
}

export function loadAllInstructions() {
    return {
        identity: loadInstruction("Identity.md"),
        behavior: loadInstruction("Behavior.md"),
        skills: loadInstruction("Skills.md"),
        tools: loadInstruction("Tools.md"),
        memory: loadInstruction("Memory.md"),
    };
}
