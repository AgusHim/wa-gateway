import { sessionRepo } from "@/lib/db/sessionRepo";

type HumanHandoverState = {
    pending: boolean;
    topic?: string;
    keyword?: string;
    triggeredAt: string;
    lastUserMessage?: string;
};

const HANDOVER_PREFIX = "human-handover:";

function keyForPhone(phoneNumber: string): string {
    return `${HANDOVER_PREFIX}${phoneNumber}`;
}

function normalizePhoneIdentifier(input: string): string {
    return input.trim();
}

export const handoverRepo = {
    async getState(phoneNumber: string): Promise<HumanHandoverState | null> {
        const normalized = normalizePhoneIdentifier(phoneNumber);
        if (!normalized) return null;

        const row = await sessionRepo.getSession(keyForPhone(normalized));
        if (!row?.data) return null;

        try {
            return JSON.parse(row.data) as HumanHandoverState;
        } catch {
            return null;
        }
    },

    async isPending(phoneNumber: string): Promise<boolean> {
        const state = await this.getState(phoneNumber);
        return Boolean(state?.pending);
    },

    async markPending(input: {
        phoneNumber: string;
        topic?: string;
        keyword?: string;
        lastUserMessage?: string;
    }): Promise<void> {
        const normalized = normalizePhoneIdentifier(input.phoneNumber);
        if (!normalized) return;

        const payload: HumanHandoverState = {
            pending: true,
            topic: input.topic,
            keyword: input.keyword,
            triggeredAt: new Date().toISOString(),
            lastUserMessage: input.lastUserMessage,
        };

        await sessionRepo.saveSession(keyForPhone(normalized), JSON.stringify(payload));
    },

    async clearPending(phoneNumber: string): Promise<void> {
        const normalized = normalizePhoneIdentifier(phoneNumber);
        if (!normalized) return;

        await sessionRepo.deleteSession(keyForPhone(normalized));
    },

    async getPendingPhoneSet(phoneNumbers?: string[]): Promise<Set<string>> {
        const rows = await sessionRepo.listSessionsByPrefix(HANDOVER_PREFIX);
        const filter = phoneNumbers?.length
            ? new Set(phoneNumbers.map((item) => normalizePhoneIdentifier(item)).filter(Boolean))
            : null;
        const pending = new Set<string>();

        for (const row of rows) {
            const phone = row.id.slice(HANDOVER_PREFIX.length).trim();
            if (!phone) continue;
            if (filter && !filter.has(phone)) continue;

            try {
                const state = JSON.parse(row.data) as HumanHandoverState;
                if (state.pending) {
                    pending.add(phone);
                }
            } catch {
                continue;
            }
        }

        return pending;
    },
};
