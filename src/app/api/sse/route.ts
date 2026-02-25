import { waEvents } from "@/lib/baileys/events";

export const runtime = "nodejs";

function toSSE(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request) {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const encoder = new TextEncoder();

            const onQr = (qr: string) => {
                controller.enqueue(encoder.encode(toSSE("qr", { qr })));
            };

            const onConnection = (payload: { status: "open" | "close" | "connecting"; message?: string }) => {
                controller.enqueue(encoder.encode(toSSE("connection-update", payload)));
            };

            const onMessage = (payload: {
                phoneNumber: string;
                messageText: string;
                messageId: string;
                pushName?: string;
                timestamp: number;
            }) => {
                controller.enqueue(encoder.encode(toSSE("new-message", payload)));
            };

            waEvents.on("qr", onQr);
            waEvents.on("connection-update", onConnection);
            waEvents.on("new-message", onMessage);

            // Initial event so clients know the stream is connected.
            controller.enqueue(encoder.encode(toSSE("connected", { ok: true })));

            const heartbeat = setInterval(() => {
                controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
            }, 15000);

            const cleanup = () => {
                clearInterval(heartbeat);
                waEvents.off("qr", onQr);
                waEvents.off("connection-update", onConnection);
                waEvents.off("new-message", onMessage);
            };

            request.signal.addEventListener("abort", () => {
                cleanup();
                controller.close();
            });
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
        },
    });
}
