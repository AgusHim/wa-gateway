import { waEvents } from "@/lib/baileys/events";
import { requireApiSession } from "@/lib/auth/apiSession";
import { ensureGatewayBootstrapped } from "@/lib/runtime/bootstrapServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function toSSE(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request) {
    const auth = await requireApiSession("read");
    if (!auth.ok) {
        return auth.response;
    }

    await ensureGatewayBootstrapped();

    const { getWorkspaceChannelRuntimeStatus } = await import("@/lib/baileys/client");
    const initialChannels = await getWorkspaceChannelRuntimeStatus(auth.context.workspaceId);

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const encoder = new TextEncoder();
            let isClosed = false;

            const send = (message: string) => {
                if (isClosed) return;
                try {
                    controller.enqueue(encoder.encode(message));
                } catch {
                    // Stream sudah tertutup oleh proxy/browser.
                }
            };

            const onQr = (payload: {
                workspaceId: string;
                channelId: string;
                qr: string;
                expiresAt: number;
            }) => {
                if (payload.workspaceId !== auth.context.workspaceId) {
                    return;
                }

                send(toSSE("qr", payload));
            };

            const onConnection = (payload: {
                workspaceId: string;
                channelId: string;
                status: "open" | "close" | "connecting";
                healthStatus: "connected" | "degraded" | "disconnected" | "banned-risk";
                message?: string;
            }) => {
                if (payload.workspaceId !== auth.context.workspaceId) {
                    return;
                }

                send(toSSE("connection-update", payload));
            };

            const onMessage = (payload: {
                workspaceId: string;
                channelId: string;
                phoneNumber: string;
                messageText: string;
                messageId: string;
                pushName?: string;
                timestamp: number;
            }) => {
                if (payload.workspaceId !== auth.context.workspaceId) {
                    return;
                }

                send(toSSE("new-message", payload));
            };

            waEvents.on("qr", onQr);
            waEvents.on("connection-update", onConnection);
            waEvents.on("new-message", onMessage);

            // Force flush awal agar proxy (Nginx/Cloudflare) tidak menahan stream.
            send(`: ${" ".repeat(2048)}\n`);
            send("retry: 5000\n\n");
            send(toSSE("connected", { ok: true }));

            for (const channel of initialChannels) {
                send(toSSE("connection-update", {
                    workspaceId: auth.context.workspaceId,
                    channelId: channel.channelId,
                    status: channel.status,
                    healthStatus: channel.healthStatus.toLowerCase().replace("_", "-") as "connected" | "degraded" | "disconnected" | "banned-risk",
                }));

                if (channel.qr) {
                    send(toSSE("qr", {
                        workspaceId: auth.context.workspaceId,
                        channelId: channel.channelId,
                        qr: channel.qr,
                        expiresAt: channel.qrExpiresAt || Date.now(),
                    }));
                }
            }

            const heartbeat = setInterval(() => {
                send(`: keepalive ${Date.now()}\n\n`);
            }, 15000);

            const cleanup = () => {
                if (isClosed) return;
                isClosed = true;
                clearInterval(heartbeat);
                waEvents.off("qr", onQr);
                waEvents.off("connection-update", onConnection);
                waEvents.off("new-message", onMessage);
            };

            request.signal.addEventListener("abort", () => {
                cleanup();
                try {
                    controller.close();
                } catch {
                    // noop
                }
            });
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
            "Content-Encoding": "none",
        },
    });
}
