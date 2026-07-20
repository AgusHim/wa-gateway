import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { messageRepo } from "@/lib/db/messageRepo";
import { createPrivateMediaStream, getPrivateMediaInfo } from "@/lib/media/storage";
import { parseByteRange } from "@/lib/conversations/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ attachmentId: string }> };

function safeContentDisposition(fileName: string, inline: boolean): string {
    const asciiName = fileName.replace(/[^a-zA-Z0-9._() -]/g, "_").slice(0, 180) || "attachment.bin";
    return `${inline ? "inline" : "attachment"}; filename="${asciiName.replace(/"/g, "")}"`;
}

export async function GET(request: NextRequest, context: RouteContext) {
    const auth = await requireApiSession("read");
    if (!auth.ok) return auth.response;

    const { attachmentId } = await context.params;
    const attachment = await messageRepo.getAttachment(auth.context.workspaceId, attachmentId);
    if (!attachment || attachment.status !== "ready" || !attachment.storageKey) {
        return new Response("Media not found", { status: 404 });
    }

    try {
        const info = await getPrivateMediaInfo(attachment.storageKey);
        const range = parseByteRange(request.headers.get("range"), info.byteSize);
        if (range === "invalid") {
            return new Response(null, {
                status: 416,
                headers: { "Content-Range": `bytes */${info.byteSize}` },
            });
        }

        const selectedRange = range || { start: 0, end: info.byteSize - 1 };
        const nodeStream = await createPrivateMediaStream(info, range || undefined);
        const headers = new Headers({
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=300",
            "Content-Disposition": safeContentDisposition(
                attachment.fileName || "attachment.bin",
                attachment.type === "audio" || attachment.type === "sticker"
            ),
            "Content-Length": String(selectedRange.end - selectedRange.start + 1),
            "Content-Type": attachment.mimeType,
            "X-Content-Type-Options": "nosniff",
        });
        if (range) {
            headers.set("Content-Range", `bytes ${range.start}-${range.end}/${info.byteSize}`);
        }

        return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
            status: range ? 206 : 200,
            headers,
        });
    } catch {
        return new Response("Media not found", { status: 404 });
    }
}
