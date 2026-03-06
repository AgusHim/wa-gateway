export type PublicApiClientOptions = {
    baseUrl: string;
    apiKey: string;
    timeoutMs?: number;
};

export type SendMessageInput = {
    phoneNumber: string;
    text: string;
    channelId?: string;
    mode?: "chat" | "broadcast" | "notification";
    templateId?: string;
};

export type SyncContactInput = {
    phoneNumber: string;
    name?: string;
    label?: string;
    segments?: string[];
};

type ApiResponse<T> = {
    success: boolean;
    message?: string;
    data?: T;
};

export class WaGatewayPublicApiClient {
    private readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly timeoutMs: number;

    constructor(options: PublicApiClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, "");
        this.apiKey = options.apiKey.trim();
        this.timeoutMs = options.timeoutMs ?? 10_000;
    }

    private async request<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
        const response = await fetch(`${this.baseUrl}${path}`, {
            ...init,
            headers: {
                "x-api-key": this.apiKey,
                ...(init?.body ? { "content-type": "application/json" } : {}),
                ...(init?.headers || {}),
            },
            signal: AbortSignal.timeout(this.timeoutMs),
        });

        return response.json() as Promise<ApiResponse<T>>;
    }

    sendMessage(input: SendMessageInput) {
        return this.request<{ jobId?: string; workspaceId: string; channelId: string; phoneNumber: string }>(
            "/api/public/v1/messages/send",
            {
                method: "POST",
                body: JSON.stringify(input),
            }
        );
    }

    syncContacts(contacts: SyncContactInput[]) {
        return this.request<{ total: number; created: number; updated: number }>(
            "/api/public/v1/contacts/sync",
            {
                method: "POST",
                body: JSON.stringify({ contacts }),
            }
        );
    }

    getConversations(params?: { phoneNumber?: string; page?: number; limit?: number }) {
        const search = new URLSearchParams();
        if (params?.phoneNumber) search.set("phoneNumber", params.phoneNumber);
        if (params?.page) search.set("page", String(params.page));
        if (params?.limit) search.set("limit", String(params.limit));
        const query = search.toString();
        return this.request<unknown>(`/api/public/v1/conversations${query ? `?${query}` : ""}`);
    }

    getUsage() {
        return this.request<unknown>("/api/public/v1/usage");
    }
}
