declare global {
    var __waGatewayBootPromise: Promise<void> | undefined;
}

export function ensureGatewayBootstrapped(): Promise<void> {
    if (process.env.NEXT_RUNTIME !== "nodejs") {
        return Promise.resolve();
    }

    if (!globalThis.__waGatewayBootPromise) {
        globalThis.__waGatewayBootPromise = (async () => {
            try {
                const { bootstrap } = await import("@/agent/bootstrap");
                await bootstrap();
            } catch (error) {
                console.error("[Bootstrap] Failed to start gateway:", error);
                globalThis.__waGatewayBootPromise = undefined;
                throw error;
            }
        })();
    }

    return globalThis.__waGatewayBootPromise;
}
