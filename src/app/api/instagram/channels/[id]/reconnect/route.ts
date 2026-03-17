import { NextRequest } from "next/server";
import { POST as connectPost } from "@/app/api/instagram/channels/[id]/connect/route";

export const runtime = "nodejs";

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    return connectPost(request, context);
}

