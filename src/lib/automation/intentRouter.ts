export type ConversationIntent = "faq" | "support" | "sales" | "escalation" | "general";

const INTENT_KEYWORDS: Record<ConversationIntent, string[]> = {
    faq: [
        "apa",
        "bagaimana",
        "dimana",
        "kapan",
        "berapa",
        "faq",
        "informasi",
    ],
    support: [
        "error",
        "masalah",
        "gagal",
        "tidak bisa",
        "kendala",
        "bantuan",
        "support",
        "help",
    ],
    sales: [
        "harga",
        "paket",
        "promo",
        "diskon",
        "beli",
        "order",
        "langganan",
        "trial",
        "upgrade",
    ],
    escalation: [
        "komplain",
        "refund",
        "sengketa",
        "hukum",
        "somasi",
        "operator",
        "cs manusia",
        "agen manusia",
        "manusia",
    ],
    general: [],
};

const INTENT_SEGMENT_MAP: Record<ConversationIntent, string[]> = {
    faq: ["info-seeker"],
    support: ["support-request"],
    sales: ["sales-lead"],
    escalation: ["needs-human"],
    general: [],
};

function normalizeText(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function detectConversationIntent(message: string): {
    intent: ConversationIntent;
    confidence: number;
    matchedKeywords: string[];
} {
    const normalized = normalizeText(message);
    if (!normalized) {
        return {
            intent: "general",
            confidence: 0,
            matchedKeywords: [],
        };
    }

    const ranked = (Object.keys(INTENT_KEYWORDS) as ConversationIntent[])
        .filter((intent) => intent !== "general")
        .map((intent) => {
            const keywords = INTENT_KEYWORDS[intent].filter((keyword) => normalized.includes(keyword));
            return {
                intent,
                score: keywords.length,
                keywords,
            };
        })
        .sort((a, b) => b.score - a.score);

    const top = ranked[0];
    if (!top || top.score === 0) {
        return {
            intent: "general",
            confidence: 0,
            matchedKeywords: [],
        };
    }

    const totalKeywords = INTENT_KEYWORDS[top.intent].length;
    const confidence = totalKeywords > 0 ? Math.min(1, top.score / totalKeywords) : 0;

    return {
        intent: top.intent,
        confidence,
        matchedKeywords: top.keywords,
    };
}

export function deriveSegmentsFromIntent(intent: ConversationIntent): string[] {
    return INTENT_SEGMENT_MAP[intent] || [];
}

export function shouldEscalateFromIntent(intent: ConversationIntent): boolean {
    return intent === "escalation";
}
