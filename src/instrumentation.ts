import { ensureGatewayBootstrapped } from "@/lib/runtime/bootstrapServer";

export async function register() {
    // Skip bootstrap during edge runtime.
    if (process.env.NEXT_RUNTIME === "edge") {
        return;
    }

    await ensureGatewayBootstrapped();
}
