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

export function reloadInstructions(): void {
    cache.clear();
    loadAllInstructions();
    console.log("[Instructions] All instructions reloaded");
}

export function updateInstruction(fileName: string, content: string): void {
    const filePath = path.join(INSTRUCTIONS_DIR, fileName);
    fs.writeFileSync(filePath, content, "utf-8");
    cache.set(fileName, content);
    console.log(`[Instructions] ${fileName} updated and cached`);
}

export function getInstructionFiles(): string[] {
    if (!fs.existsSync(INSTRUCTIONS_DIR)) return [];
    return fs.readdirSync(INSTRUCTIONS_DIR).filter((f) => f.endsWith(".md"));
}
