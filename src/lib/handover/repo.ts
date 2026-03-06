import { HandoverTicketStatus } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { assertTenantScope } from "@/lib/tenant/context";

type HumanHandoverState = {
    pending: boolean;
    topic?: string;
    keyword?: string;
    triggeredAt: string;
    slaDueAt?: string;
    status?: HandoverTicketStatus;
    lastUserMessage?: string;
};

function normalizePhoneIdentifier(input: string): string {
    return input.trim();
}

function resolveSlaMinutes(): number {
    const raw = Number(process.env.HANDOVER_SLA_MINUTES || 30);
    if (!Number.isFinite(raw)) {
        return 30;
    }
    return Math.max(1, Math.min(24 * 60, Math.round(raw)));
}

function computeSlaDueAt(triggeredAt: Date): Date {
    const minutes = resolveSlaMinutes();
    return new Date(triggeredAt.getTime() + minutes * 60 * 1000);
}

export const handoverRepo = {
    async getState(phoneNumber: string, workspaceId: string): Promise<HumanHandoverState | null> {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const normalized = normalizePhoneIdentifier(phoneNumber);
        if (!normalized) return null;

        const ticket = await prisma.handoverTicket.findFirst({
            where: {
                workspaceId: resolvedWorkspaceId,
                phoneNumber: normalized,
                status: HandoverTicketStatus.OPEN,
            },
            orderBy: [{ createdAt: "desc" }],
        });

        if (!ticket) {
            return null;
        }

        return {
            pending: true,
            topic: ticket.topic || undefined,
            keyword: ticket.keyword || undefined,
            triggeredAt: ticket.createdAt.toISOString(),
            slaDueAt: ticket.slaDueAt.toISOString(),
            status: ticket.status,
            lastUserMessage: ticket.lastUserMessage || undefined,
        };
    },

    async isPending(phoneNumber: string, workspaceId: string): Promise<boolean> {
        const state = await this.getState(phoneNumber, workspaceId);
        return Boolean(state?.pending);
    },

    async markPending(input: {
        workspaceId: string;
        phoneNumber: string;
        userId?: string;
        topic?: string;
        keyword?: string;
        triggeredBy?: string;
        priority?: string;
        lastUserMessage?: string;
    }): Promise<void> {
        const resolvedWorkspaceId = assertTenantScope(input.workspaceId);
        const normalized = normalizePhoneIdentifier(input.phoneNumber);
        if (!normalized) return;

        const existing = await prisma.handoverTicket.findFirst({
            where: {
                workspaceId: resolvedWorkspaceId,
                phoneNumber: normalized,
                status: HandoverTicketStatus.OPEN,
            },
            orderBy: [{ createdAt: "desc" }],
            select: { id: true },
        });

        if (existing) {
            await prisma.handoverTicket.update({
                where: { id: existing.id },
                data: {
                    topic: input.topic,
                    keyword: input.keyword,
                    triggeredBy: input.triggeredBy,
                    priority: input.priority || "normal",
                    lastUserMessage: input.lastUserMessage,
                    updatedAt: new Date(),
                },
            });
            return;
        }

        const now = new Date();
        await prisma.handoverTicket.create({
            data: {
                workspaceId: resolvedWorkspaceId,
                userId: input.userId || null,
                phoneNumber: normalized,
                topic: input.topic,
                keyword: input.keyword,
                triggeredBy: input.triggeredBy,
                priority: input.priority || "normal",
                status: HandoverTicketStatus.OPEN,
                slaDueAt: computeSlaDueAt(now),
                lastUserMessage: input.lastUserMessage,
            },
        });
    },

    async clearPending(phoneNumber: string, workspaceId: string): Promise<void> {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const normalized = normalizePhoneIdentifier(phoneNumber);
        if (!normalized) return;

        await prisma.handoverTicket.updateMany({
            where: {
                workspaceId: resolvedWorkspaceId,
                phoneNumber: normalized,
                status: HandoverTicketStatus.OPEN,
            },
            data: {
                status: HandoverTicketStatus.RESOLVED,
                resolvedAt: new Date(),
                firstResponseAt: new Date(),
            },
        });
    },

    async getPendingPhoneSet(phoneNumbers: string[] | undefined, workspaceId: string): Promise<Set<string>> {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);
        const filter = phoneNumbers?.length
            ? Array.from(new Set(phoneNumbers.map((item) => normalizePhoneIdentifier(item)).filter(Boolean)))
            : undefined;

        const rows = await prisma.handoverTicket.findMany({
            where: {
                workspaceId: resolvedWorkspaceId,
                status: HandoverTicketStatus.OPEN,
                phoneNumber: filter ? { in: filter } : undefined,
            },
            select: { phoneNumber: true },
        });

        return new Set(rows.map((row) => row.phoneNumber));
    },

    async listOpenTickets(workspaceId: string, limit: number = 100) {
        const resolvedWorkspaceId = assertTenantScope(workspaceId);

        return prisma.handoverTicket.findMany({
            where: {
                workspaceId: resolvedWorkspaceId,
                status: HandoverTicketStatus.OPEN,
            },
            orderBy: [{ slaDueAt: "asc" }, { createdAt: "asc" }],
            take: Math.max(1, Math.min(1000, Math.round(limit))),
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        phoneNumber: true,
                        label: true,
                    },
                },
            },
        });
    },
};
