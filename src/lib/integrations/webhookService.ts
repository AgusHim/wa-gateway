import crypto from "crypto";
import { Prisma, WebhookDeliveryStatus, WebhookEndpointStatus, WebhookEventType } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { buildWebhookSignature } from "@/lib/integrations/webhookSignature";
import { decryptString, encryptString, packEncryptedPayload, unpackEncryptedPayload } from "@/lib/security/crypto";
import { assertTenantScope } from "@/lib/tenant/context";

let dispatcherTimer: NodeJS.Timeout | null = null;
let dispatcherInFlight = false;

function parseHeaders(input: Prisma.JsonValue | null | undefined): Record<string, string> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return {};
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) {
        if (typeof value === "string" && key.trim()) {
            headers[key.trim()] = value;
        }
    }

    return headers;
}

function computeBackoffMs(attempt: number): number {
    const normalized = Math.max(1, Math.min(16, attempt));
    return Math.min(30 * 60 * 1000, Math.pow(2, normalized) * 1000);
}

function parseEventRows(rawEvents: string[] | WebhookEventType[]): WebhookEventType[] {
    const values = rawEvents
        .map((item) => String(item).trim().toUpperCase())
        .filter((item): item is WebhookEventType => Object.values(WebhookEventType).includes(item as WebhookEventType));

    if (values.length === 0) {
        return [
            WebhookEventType.MESSAGE_RECEIVED,
            WebhookEventType.MESSAGE_SENT,
            WebhookEventType.HANDOVER_CREATED,
            WebhookEventType.TOOL_FAILED,
        ];
    }

    return Array.from(new Set(values));
}

export const webhookService = {
    async listEndpoints(workspaceId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.webhookEndpoint.findMany({
            where: { workspaceId: resolvedWorkspaceId },
            orderBy: [{ createdAt: "desc" }],
        });
    },

    async createEndpoint(input: {
        workspaceId: string;
        name: string;
        url: string;
        secret: string;
        events: string[] | WebhookEventType[];
        timeoutMs?: number;
        maxAttempts?: number;
        includeHeaders?: Record<string, string>;
        createdByUserId?: string;
    }) {
        const workspaceId = assertTenantScope(input.workspaceId);
        const secret = input.secret.trim();
        if (!secret) {
            throw new Error("Webhook secret is required");
        }

        const encrypted = packEncryptedPayload(encryptString(secret));
        const events = parseEventRows(input.events);

        return prisma.webhookEndpoint.create({
            data: {
                workspaceId,
                name: input.name.trim(),
                url: input.url.trim(),
                secretEncrypted: encrypted,
                events,
                status: WebhookEndpointStatus.ACTIVE,
                timeoutMs: Number.isFinite(input.timeoutMs) ? Math.max(1000, Math.min(30000, Math.round(input.timeoutMs as number))) : 10000,
                maxAttempts: Number.isFinite(input.maxAttempts) ? Math.max(1, Math.min(20, Math.round(input.maxAttempts as number))) : 6,
                includeHeaders: (input.includeHeaders || {}) as Prisma.InputJsonValue,
                createdByUserId: input.createdByUserId,
            },
        });
    },

    async updateEndpointStatus(workspaceId: string, endpointId: string, status: WebhookEndpointStatus) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const endpoint = await prisma.webhookEndpoint.findFirst({
            where: {
                id: endpointId,
                workspaceId: resolvedWorkspaceId,
            },
            select: { id: true },
        });
        if (!endpoint) {
            throw new Error("Webhook endpoint not found");
        }

        return prisma.webhookEndpoint.update({
            where: { id: endpoint.id },
            data: { status },
        });
    },

    async listDeliveries(workspaceId: string, limit: number = 200) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        return prisma.webhookDelivery.findMany({
            where: { workspaceId: resolvedWorkspaceId },
            include: {
                endpoint: {
                    select: {
                        id: true,
                        name: true,
                        url: true,
                    },
                },
            },
            orderBy: [{ createdAt: "desc" }],
            take: Math.max(1, Math.min(1000, Math.round(limit))),
        });
    },

    async enqueueEvent(input: {
        workspaceId: string;
        eventType: WebhookEventType | string;
        payload: Record<string, unknown>;
        eventId?: string;
    }) {
        const workspaceId = assertTenantScope(input.workspaceId);
        const [eventType] = parseEventRows([input.eventType]);
        if (!eventType) {
            return { queued: 0 };
        }
        const endpoints = await prisma.webhookEndpoint.findMany({
            where: {
                workspaceId,
                status: WebhookEndpointStatus.ACTIVE,
                events: {
                    has: eventType,
                },
            },
            select: {
                id: true,
                maxAttempts: true,
            },
        });

        if (endpoints.length === 0) {
            return { queued: 0 };
        }

        const eventId = input.eventId || crypto.randomUUID();
        const envelope = {
            id: eventId,
            type: eventType,
            workspaceId,
            timestamp: new Date().toISOString(),
            data: input.payload,
        };

        await prisma.$transaction(
            endpoints.map((endpoint) => prisma.webhookDelivery.create({
                data: {
                    workspaceId,
                    endpointId: endpoint.id,
                    eventType,
                    eventId,
                    status: WebhookDeliveryStatus.PENDING,
                    maxAttempts: endpoint.maxAttempts,
                    requestBody: envelope as Prisma.InputJsonValue,
                    nextAttemptAt: new Date(),
                },
            }))
        );

        return { queued: endpoints.length };
    },

    async dispatchDelivery(deliveryId: string) {
        const delivery = await prisma.webhookDelivery.findUnique({
            where: { id: deliveryId },
            include: {
                endpoint: true,
            },
        });

        if (!delivery) {
            return null;
        }

        if (delivery.status === WebhookDeliveryStatus.SUCCESS || delivery.status === WebhookDeliveryStatus.DEAD) {
            return delivery;
        }

        if (delivery.endpoint.status !== WebhookEndpointStatus.ACTIVE) {
            return prisma.webhookDelivery.update({
                where: { id: delivery.id },
                data: {
                    status: WebhookDeliveryStatus.CANCELED,
                    error: "endpoint_inactive",
                },
            });
        }

        const nextAttempt = delivery.attempt + 1;
        await prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
                status: WebhookDeliveryStatus.SENDING,
                attempt: nextAttempt,
            },
        });

        const bodyObject = delivery.requestBody && typeof delivery.requestBody === "object" && !Array.isArray(delivery.requestBody)
            ? delivery.requestBody as Record<string, unknown>
            : { data: delivery.requestBody };
        const rawBody = JSON.stringify(bodyObject);
        const timestamp = String(Math.floor(Date.now() / 1000));
        const secret = decryptString(unpackEncryptedPayload(delivery.endpoint.secretEncrypted));
        const signature = buildWebhookSignature(secret, timestamp, rawBody);

        const timeoutMs = Math.max(1000, Math.min(30_000, delivery.endpoint.timeoutMs));
        const requestHeaders: Record<string, string> = {
            "content-type": "application/json",
            "x-wa-signature": signature,
            "x-wa-timestamp": timestamp,
            "x-wa-delivery-id": delivery.id,
            "x-wa-event-id": delivery.eventId,
            "x-wa-event": delivery.eventType,
            "x-wa-retry-attempt": String(nextAttempt),
            ...parseHeaders(delivery.endpoint.includeHeaders),
        };

        try {
            const response = await fetch(delivery.endpoint.url, {
                method: "POST",
                headers: requestHeaders,
                body: rawBody,
                signal: AbortSignal.timeout(timeoutMs),
            });
            const responseBody = (await response.text()).slice(0, 5000);

            if (response.ok) {
                await prisma.$transaction([
                    prisma.webhookEndpoint.update({
                        where: { id: delivery.endpoint.id },
                        data: {
                            lastDeliveredAt: new Date(),
                            lastError: null,
                        },
                    }),
                    prisma.webhookDelivery.update({
                        where: { id: delivery.id },
                        data: {
                            status: WebhookDeliveryStatus.SUCCESS,
                            deliveredAt: new Date(),
                            requestHeaders: requestHeaders as Prisma.InputJsonValue,
                            responseStatus: response.status,
                            responseBody,
                            error: null,
                        },
                    }),
                ]);
            } else {
                const reachedMax = nextAttempt >= delivery.maxAttempts;
                await prisma.$transaction([
                    prisma.webhookEndpoint.update({
                        where: { id: delivery.endpoint.id },
                        data: {
                            lastError: `HTTP ${response.status}`,
                        },
                    }),
                    prisma.webhookDelivery.update({
                        where: { id: delivery.id },
                        data: {
                            status: reachedMax ? WebhookDeliveryStatus.DEAD : WebhookDeliveryStatus.FAILED,
                            requestHeaders: requestHeaders as Prisma.InputJsonValue,
                            responseStatus: response.status,
                            responseBody,
                            error: `HTTP ${response.status}`,
                            nextAttemptAt: reachedMax
                                ? delivery.nextAttemptAt
                                : new Date(Date.now() + computeBackoffMs(nextAttempt)),
                        },
                    }),
                ]);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : "webhook_dispatch_failed";
            const reachedMax = nextAttempt >= delivery.maxAttempts;
            await prisma.$transaction([
                prisma.webhookEndpoint.update({
                    where: { id: delivery.endpoint.id },
                    data: {
                        lastError: message.slice(0, 1000),
                    },
                }),
                prisma.webhookDelivery.update({
                    where: { id: delivery.id },
                    data: {
                        status: reachedMax ? WebhookDeliveryStatus.DEAD : WebhookDeliveryStatus.FAILED,
                        requestHeaders: requestHeaders as Prisma.InputJsonValue,
                        error: message.slice(0, 2000),
                        nextAttemptAt: reachedMax
                            ? delivery.nextAttemptAt
                            : new Date(Date.now() + computeBackoffMs(nextAttempt)),
                    },
                }),
            ]);
        }

        return prisma.webhookDelivery.findUnique({
            where: { id: delivery.id },
            include: {
                endpoint: true,
            },
        });
    },

    async dispatchDue(limit: number = 100) {
        const due = await prisma.webhookDelivery.findMany({
            where: {
                status: {
                    in: [WebhookDeliveryStatus.PENDING, WebhookDeliveryStatus.FAILED],
                },
                nextAttemptAt: {
                    lte: new Date(),
                },
                endpoint: {
                    status: WebhookEndpointStatus.ACTIVE,
                },
            },
            orderBy: [{ nextAttemptAt: "asc" }],
            take: Math.max(1, Math.min(500, Math.round(limit))),
            select: {
                id: true,
            },
        });

        for (const row of due) {
            try {
                await this.dispatchDelivery(row.id);
            } catch (error) {
                console.error(`[Webhook] dispatch failed id=${row.id}`, error);
            }
        }

        return due.length;
    },

    async replayDelivery(workspaceId: string, deliveryId: string) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const source = await prisma.webhookDelivery.findFirst({
            where: {
                id: deliveryId,
                workspaceId: resolvedWorkspaceId,
            },
            include: {
                endpoint: {
                    select: {
                        id: true,
                        maxAttempts: true,
                    },
                },
            },
        });
        if (!source) {
            throw new Error("Webhook delivery not found");
        }

        return prisma.webhookDelivery.create({
            data: {
                workspaceId: source.workspaceId,
                endpointId: source.endpoint.id,
                eventType: source.eventType,
                eventId: source.eventId,
                status: WebhookDeliveryStatus.PENDING,
                maxAttempts: source.endpoint.maxAttempts,
                requestBody: source.requestBody as Prisma.InputJsonValue,
                nextAttemptAt: new Date(),
                replayOfId: source.id,
            },
        });
    },

    startDispatcher(intervalMs: number = 10_000) {
        if (dispatcherTimer) {
            return;
        }

        const run = () => {
            if (dispatcherInFlight) {
                return;
            }

            dispatcherInFlight = true;
            this.dispatchDue()
                .catch((error) => {
                    console.error("[Webhook] dispatcher failed", error);
                })
                .finally(() => {
                    dispatcherInFlight = false;
                });
        };

        run();
        dispatcherTimer = setInterval(run, Math.max(3000, intervalMs));
    },
};
