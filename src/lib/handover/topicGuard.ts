const DEFAULT_TOPIC_KEYWORDS: Record<string, string[]> = {
    explicit_human_request: [
        "admin",
        "operator",
        "cs manusia",
        "customer service",
        "tim support",
        "agen manusia",
        "orang asli",
        "minta manusia",
    ],
    billing_refund_dispute: [
        "refund",
        "pengembalian dana",
        "uang kembali",
        "sengketa pembayaran",
        "komplain pembayaran",
        "double charge",
        "tagihan ganda",
        "chargeback",
        "gagal bayar",
    ],
    legal_escalation: [
        "somasi",
        "jalur hukum",
        "lapor polisi",
        "pengacara",
        "lawyer",
        "tuntutan",
    ],
    account_security_takeover: [
        "akun saya diambil",
        "akun dibajak",
        "hack akun",
        "peretasan",
        "kebocoran data",
        "penipuan",
    ],
};

export type HumanHandoverMatch = {
    requiresHuman: boolean;
    topic?: string;
    keyword?: string;
};

function parseExtraKeywords(): string[] {
    const raw = (process.env.HUMAN_HANDOVER_KEYWORDS || "").trim();
    if (!raw) return [];

    return raw
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
}

function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

export function detectHumanHandoverTopic(message: string): HumanHandoverMatch {
    const normalized = normalizeText(message);
    if (!normalized) {
        return { requiresHuman: false };
    }

    for (const [topic, keywords] of Object.entries(DEFAULT_TOPIC_KEYWORDS)) {
        for (const keyword of keywords) {
            if (normalized.includes(keyword)) {
                return {
                    requiresHuman: true,
                    topic,
                    keyword,
                };
            }
        }
    }

    for (const keyword of parseExtraKeywords()) {
        if (normalized.includes(keyword)) {
            return {
                requiresHuman: true,
                topic: "custom_keyword",
                keyword,
            };
        }
    }

    return { requiresHuman: false };
}
