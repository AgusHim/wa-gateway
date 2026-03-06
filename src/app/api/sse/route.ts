import { waEvents } from "@/lib/baileys/events";
import { requireApiSession } from "@/lib/auth/apiSession";
import { ensureGatewayBootstrapped } from "@/lib/runtime/bootstrapServer";

export const runtime = "nodejs";

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

            const onQr = (payload: {
                workspaceId: string;
                channelId: string;
                qr: string;
                expiresAt: number;
            }) => {
                if (payload.workspaceId !== auth.context.workspaceId) {
                    return;
                }

                controller.enqueue(encoder.encode(toSSE("qr", payload)));
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

                controller.enqueue(encoder.encode(toSSE("connection-update", payload)));
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

                controller.enqueue(encoder.encode(toSSE("new-message", payload)));
            };

            waEvents.on("qr", onQr);
            waEvents.on("connection-update", onConnection);
            waEvents.on("new-message", onMessage);

            controller.enqueue(encoder.encode(toSSE("connected", { ok: true })));

            for (const channel of initialChannels) {
                controller.enqueue(encoder.encode(toSSE("connection-update", {
                    workspaceId: auth.context.workspaceId,
                    channelId: channel.channelId,
                    status: channel.status,
                    healthStatus: channel.healthStatus.toLowerCase().replace("_", "-") as "connected" | "degraded" | "disconnected" | "banned-risk",
                })));

                if (channel.qr) {
                    controller.enqueue(encoder.encode(toSSE("qr", {
                        workspaceId: auth.context.workspaceId,
                        channelId: channel.channelId,
                        qr: channel.qr,
                        expiresAt: channel.qrExpiresAt || Date.now(),
                    })));
                }
            }

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
