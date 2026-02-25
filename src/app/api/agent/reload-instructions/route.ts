import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
    const { reloadInstructions, getInstructionFiles } = await import("@/lib/instructions/loader");
    reloadInstructions();

    return NextResponse.json({
        success: true,
        files: getInstructionFiles(),
    });
}
