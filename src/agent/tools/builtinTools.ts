import { Tool } from "./registry";
import { userRepo } from "../../lib/db/userRepo";
import { memoryRepo } from "../../lib/db/memoryRepo";
import { workspaceCredentialRepo } from "@/lib/db/workspaceCredentialRepo";
import { knowledgeService } from "@/lib/knowledge/service";

const DEFAULT_SMARTSCHOLAR_API_BASE_URL =
    process.env.SMARTSCHOLAR_API_BASE_URL || "https://api.smartscholar.id";
const ALLOWED_SMARTSCHOLAR_HOSTS = (
    process.env.SMARTSCHOLAR_API_ALLOWED_HOSTS || "api.smartscholar.id"
)
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
const DEFAULT_WEBHOOK_BASE_URL = process.env.TOOL_WEBHOOK_BASE_URL || "";
const ALLOWED_WEBHOOK_HOSTS = (
    process.env.TOOL_WEBHOOK_ALLOWED_HOSTS || ""
)
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
const DEFAULT_CRM_SYNC_URL = process.env.CRM_SYNC_BASE_URL || "";
const ALLOWED_CRM_HOSTS = (
    process.env.CRM_SYNC_ALLOWED_HOSTS || ""
)
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

const MAX_HTTP_BODY_CHARS = 4000;
const ALLOWED_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

async function readCredentialSecret(workspaceId: string, name: string): Promise<string | null> {
    if (!name.trim()) {
        return null;
    }

    try {
        return await workspaceCredentialRepo.getCredentialSecret(workspaceId, name);
    } catch {
        return null;
    }
}

async function resolveCredentialWithEnvFallback(input: {
    workspaceId: string;
    credentialName: string;
    envFallback?: string;
}): Promise<string | null> {
    const secret = await readCredentialSecret(input.workspaceId, input.credentialName);
    if (secret?.trim()) {
        return secret.trim();
    }

    if (!input.envFallback) {
        return null;
    }

    const envValue = process.env[input.envFallback]?.trim();
    return envValue || null;
}

/**
 * Tool: get_user_info — Retrieves user information from the database.
 */
export const getUserInfoTool: Tool = {
    name: "get_user_info",
    description: "Ambil informasi dan memori user dari database berdasarkan nomor telepon",
    parameters: {
        type: "object",
        properties: {
            phoneNumber: {
                type: "string",
                description: "Nomor telepon user (tanpa @s.whatsapp.net)",
            },
        },
        required: ["phoneNumber"],
    },
    execute: async (params, context) => {
        const user = await userRepo.getUserByPhone(params.phoneNumber, context.workspaceId);
        if (!user) {
            return "User tidak ditemukan di database.";
        }

        const memories = await memoryRepo.getMemoriesByUser(
            user.id,
            context.workspaceId,
            context.channelId
        ) as Array<{ key: string; value: string }>;
        const memoryStr = memories.length > 0
            ? memories.map((m) => `  ${m.key}: ${m.value}`).join("\n")
            : "  (belum ada memori)";

        return `User Info:
  Nama: ${user.name ?? "Belum diketahui"}
  Nomor: ${user.phoneNumber}
  Label: ${user.label ?? "-"}
  Status: ${user.isBlocked ? "Blocked" : "Active"}
  
Memori:
${memoryStr}`;
    },
};

/**
 * Tool: save_note — Saves a fact/note about the user to long-term memory.
 */
export const saveNoteTool: Tool = {
    name: "save_note",
    description: "Simpan catatan/fakta baru tentang user ke memori jangka panjang",
    parameters: {
        type: "object",
        properties: {
            key: {
                type: "string",
                description: "Kategori fakta, misalnya: name, city, university, major, scholarship_target",
            },
            value: {
                type: "string",
                description: "Nilai/isi dari fakta tersebut",
            },
        },
        required: ["key", "value"],
    },
    execute: async (params, context) => {
        await memoryRepo.upsertMemory({
            workspaceId: context.workspaceId,
            userId: context.userId,
            channelId: context.channelId,
            key: params.key,
            value: params.value,
        });
        return `Berhasil menyimpan: ${params.key} = ${params.value}`;
    },
};

function resolveUrl(endpoint: string, baseUrl: string): URL {
    const target = endpoint.trim();
    if (!target) {
        throw new Error("endpoint/url wajib diisi");
    }

    if (target.startsWith("http://") || target.startsWith("https://")) {
        return new URL(target);
    }

    if (!baseUrl.trim()) {
        throw new Error("Base URL tidak dikonfigurasi");
    }

    return new URL(target, baseUrl);
}

function assertAllowedHost(url: URL, allowedHosts: string[], label: string): void {
    if (allowedHosts.length === 0) {
        return;
    }

    const host = url.host.toLowerCase();
    if (!allowedHosts.includes(host)) {
        throw new Error(
            `${label}: host "${url.host}" tidak diizinkan. Host yang diizinkan: ${allowedHosts.join(", ")}`
        );
    }
}

function parseHeaderJson(headerJson?: string): Record<string, string> {
    if (!headerJson?.trim()) return {};

    try {
        const parsed = JSON.parse(headerJson) as Record<string, unknown>;
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === "string") {
                result[key] = value;
            }
        }
        return result;
    } catch {
        throw new Error("headersJson tidak valid. Gunakan format JSON object string.");
    }
}

function normalizeMethod(method?: string): string {
    const normalized = (method || "GET").trim().toUpperCase();
    if (!ALLOWED_HTTP_METHODS.has(normalized)) {
        throw new Error(
            `Method "${method}" tidak didukung. Gunakan salah satu: ${Array.from(ALLOWED_HTTP_METHODS).join(", ")}`
        );
    }
    return normalized;
}

function hasHeader(headers: Record<string, string>, headerName: string): boolean {
    const target = headerName.toLowerCase();
    return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function buildRequestBody(
    method: string,
    bodyJson?: string,
    bodyText?: string
): string | undefined {
    if (method === "GET" || method === "HEAD") {
        return undefined;
    }

    if (bodyJson?.trim() && bodyText?.trim()) {
        throw new Error("Gunakan salah satu: bodyJson atau bodyText, jangan keduanya.");
    }

    if (bodyJson?.trim()) {
        try {
            const parsed = JSON.parse(bodyJson);
            return JSON.stringify(parsed);
        } catch {
            throw new Error("bodyJson tidak valid. Gunakan format JSON string yang benar.");
        }
    }

    if (bodyText?.trim()) {
        return bodyText;
    }

    return undefined;
}

function normalizeBodyPreview(body: string): string {
    const trimmed = body.trim();
    if (!trimmed) return "(empty body)";

    try {
        const parsed = JSON.parse(trimmed);
        const pretty = JSON.stringify(parsed, null, 2);
        return pretty.length > MAX_HTTP_BODY_CHARS
            ? `${pretty.slice(0, MAX_HTTP_BODY_CHARS)}...(truncated)`
            : pretty;
    } catch {
        return trimmed.length > MAX_HTTP_BODY_CHARS
            ? `${trimmed.slice(0, MAX_HTTP_BODY_CHARS)}...(truncated)`
            : trimmed;
    }
}

async function getSmartScholarAuthHeaders(workspaceId: string, authMode?: string): Promise<Record<string, string>> {
    const mode = (authMode || "auto").trim().toLowerCase();
    const headers: Record<string, string> = {};

    const bearerToken = await resolveCredentialWithEnvFallback({
        workspaceId,
        credentialName: "smartscholar_bearer_token",
        envFallback: "SMARTSCHOLAR_API_BEARER_TOKEN",
    });
    const cookie = await resolveCredentialWithEnvFallback({
        workspaceId,
        credentialName: "smartscholar_cookie",
        envFallback: "SMARTSCHOLAR_ADMIN_COOKIE",
    });
    const apiKey = await resolveCredentialWithEnvFallback({
        workspaceId,
        credentialName: "smartscholar_api_key",
        envFallback: "SMARTSCHOLAR_ADMIN_API_KEY",
    });

    if ((mode === "auto" || mode === "bearer") && bearerToken) {
        headers.Authorization = `Bearer ${bearerToken}`;
    }

    if ((mode === "auto" || mode === "cookie") && cookie) {
        headers.Cookie = cookie;
    }

    if ((mode === "auto" || mode === "api_key") && apiKey) {
        headers["X-API-KEY"] = apiKey;
    }

    return headers;
}

/**
 * Tool: fetch_smartscholar_endpoint
 * Calls SmartScholar API endpoint with dynamic HTTP methods (curl/browser style).
 */
export const fetchSmartScholarEndpointTool: Tool = {
    name: "fetch_smartscholar_endpoint",
    description: "Ambil data endpoint SmartScholar via HTTP (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS)",
    parameters: {
        type: "object",
        properties: {
            method: {
                type: "string",
                description: "HTTP method. Contoh: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
            },
            endpoint: {
                type: "string",
                description: "Path endpoint atau URL penuh. Contoh: /api/plans atau /admin_api/orders",
            },
            query: {
                type: "string",
                description: "Query string opsional. Contoh: page=1&limit=20",
            },
            authMode: {
                type: "string",
                description: "Mode auth: auto | none | bearer | cookie | api_key",
            },
            headersJson: {
                type: "string",
                description: "Header tambahan opsional dalam JSON string. Contoh: {\"X-Tenant\":\"abc\"}",
            },
            bodyJson: {
                type: "string",
                description: "Body request JSON string untuk method non-GET. Contoh: {\"status\":\"paid\"}",
            },
            bodyText: {
                type: "string",
                description: "Body request raw text untuk method non-GET jika tidak pakai JSON.",
            },
        },
        required: ["endpoint"],
    },
    execute: async (params, context) => {
        const method = normalizeMethod(params.method);
        const url = resolveUrl(params.endpoint, DEFAULT_SMARTSCHOLAR_API_BASE_URL);
        assertAllowedHost(url, ALLOWED_SMARTSCHOLAR_HOSTS, "SmartScholar tool");

        if (params.query?.trim()) {
            const queryParams = new URLSearchParams(params.query.trim());
            queryParams.forEach((value, key) => {
                url.searchParams.set(key, value);
            });
        }

        const mode = (params.authMode || "auto").trim().toLowerCase();
        const baseHeaders: Record<string, string> = {
            Accept: "application/json, text/plain, */*",
            "User-Agent": "wa-gateway-agent/1.0",
        };
        const authHeaders = mode === "none"
            ? {}
            : await getSmartScholarAuthHeaders(context.workspaceId, mode);
        const customHeaders = parseHeaderJson(params.headersJson);
        const headers = { ...baseHeaders, ...authHeaders, ...customHeaders };
        const body = buildRequestBody(method, params.bodyJson, params.bodyText);

        if (body !== undefined && !hasHeader(headers, "Content-Type")) {
            headers["Content-Type"] = params.bodyJson?.trim()
                ? "application/json"
                : "text/plain; charset=utf-8";
        }

        const response = await fetch(url, {
            method,
            headers,
            body,
        });

        const bodyText = await response.text();
        const responseBodyPreview = normalizeBodyPreview(bodyText);

        return [
            `Method: ${method}`,
            `HTTP ${response.status} ${response.statusText}`,
            `URL: ${url.toString()}`,
            "Body:",
            responseBodyPreview,
        ].join("\n");
    },
};

/**
 * Tool: webhook_action
 * Trigger outbound webhook with optional credential from tenant vault.
 */
export const webhookActionTool: Tool = {
    name: "webhook_action",
    description: "Kirim payload webhook ke endpoint integrasi eksternal",
    parameters: {
        type: "object",
        properties: {
            url: {
                type: "string",
                description: "URL atau path endpoint webhook",
            },
            eventName: {
                type: "string",
                description: "Nama event webhook",
            },
            payloadJson: {
                type: "string",
                description: "Payload JSON string",
            },
            method: {
                type: "string",
                description: "HTTP method, default POST",
            },
            authCredentialName: {
                type: "string",
                description: "Nama credential vault untuk Bearer token (opsional)",
            },
            headersJson: {
                type: "string",
                description: "Header tambahan opsional dalam JSON string",
            },
        },
        required: ["url", "eventName"],
    },
    execute: async (params, context) => {
        const method = normalizeMethod(params.method || "POST");
        const url = resolveUrl(params.url, DEFAULT_WEBHOOK_BASE_URL);
        assertAllowedHost(url, ALLOWED_WEBHOOK_HOSTS, "Webhook tool");

        const headers: Record<string, string> = {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
            ...parseHeaderJson(params.headersJson),
        };

        if (params.authCredentialName?.trim()) {
            const credential = await readCredentialSecret(context.workspaceId, params.authCredentialName);
            if (!credential) {
                return `Credential "${params.authCredentialName}" tidak ditemukan di vault.`;
            }
            headers.Authorization = `Bearer ${credential}`;
        }

        let parsedPayload: Record<string, unknown> = {};
        if (params.payloadJson?.trim()) {
            try {
                parsedPayload = JSON.parse(params.payloadJson) as Record<string, unknown>;
            } catch {
                throw new Error("payloadJson tidak valid.");
            }
        }

        const payload = {
            event: params.eventName,
            workspaceId: context.workspaceId,
            channelId: context.channelId || null,
            phoneNumber: context.phoneNumber,
            timestamp: new Date().toISOString(),
            data: parsedPayload,
        };

        const response = await fetch(url, {
            method,
            headers,
            body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(payload),
        });

        const responseText = await response.text();
        return [
            `Webhook ${params.eventName} -> ${url.toString()}`,
            `HTTP ${response.status} ${response.statusText}`,
            "Body:",
            normalizeBodyPreview(responseText),
        ].join("\n");
    },
};

/**
 * Tool: crm_sync_contact
 * Sync contact data to external CRM endpoint.
 */
export const crmSyncContactTool: Tool = {
    name: "crm_sync_contact",
    description: "Sinkronisasi data kontak user ke CRM eksternal",
    parameters: {
        type: "object",
        properties: {
            phoneNumber: {
                type: "string",
                description: "Nomor telepon user",
            },
            name: {
                type: "string",
                description: "Nama user",
            },
            email: {
                type: "string",
                description: "Email user (opsional)",
            },
            label: {
                type: "string",
                description: "Label user (opsional)",
            },
            endpoint: {
                type: "string",
                description: "URL/path endpoint CRM (opsional, default dari env)",
            },
            authCredentialName: {
                type: "string",
                description: "Nama credential vault untuk Bearer token (opsional)",
            },
            headersJson: {
                type: "string",
                description: "Header tambahan opsional dalam JSON string",
            },
        },
        required: ["phoneNumber"],
    },
    execute: async (params, context) => {
        const endpoint = params.endpoint?.trim() || DEFAULT_CRM_SYNC_URL;
        const url = resolveUrl(endpoint, DEFAULT_CRM_SYNC_URL);
        assertAllowedHost(url, ALLOWED_CRM_HOSTS, "CRM sync tool");

        const headers: Record<string, string> = {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
            ...parseHeaderJson(params.headersJson),
        };

        if (params.authCredentialName?.trim()) {
            const credential = await readCredentialSecret(context.workspaceId, params.authCredentialName);
            if (!credential) {
                return `Credential "${params.authCredentialName}" tidak ditemukan di vault.`;
            }
            headers.Authorization = `Bearer ${credential}`;
        }

        const payload = {
            workspaceId: context.workspaceId,
            channelId: context.channelId || null,
            source: "wa-gateway",
            contact: {
                phoneNumber: params.phoneNumber,
                name: params.name || null,
                email: params.email || null,
                label: params.label || null,
            },
        };

        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
        });

        const responseText = await response.text();
        return [
            `CRM sync -> ${url.toString()}`,
            `HTTP ${response.status} ${response.statusText}`,
            "Body:",
            normalizeBodyPreview(responseText),
        ].join("\n");
    },
};

/**
 * Tool: search_knowledge
 * Search indexed workspace knowledge chunks.
 */
export const searchKnowledgeTool: Tool = {
    name: "search_knowledge",
    description: "Cari informasi dari knowledge base workspace (text/url/file yang sudah diindeks)",
    parameters: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "Pertanyaan atau kata kunci yang ingin dicari",
            },
            limit: {
                type: "string",
                description: "Maksimal hasil yang diambil (default 5, max 20)",
            },
        },
        required: ["query"],
    },
    execute: async (params, context) => {
        const limitRaw = Number(params.limit);
        const limit = Number.isFinite(limitRaw)
            ? Math.max(1, Math.min(20, Math.round(limitRaw)))
            : 5;

        const results = await knowledgeService.search(context.workspaceId, params.query, limit);
        if (results.length === 0) {
            return "Tidak ada knowledge yang relevan ditemukan.";
        }

        return results.map((item, index) => (
            `${index + 1}. [${item.sourceTitle} v${item.sourceVersion}] score=${item.score}\n${item.content}`
        )).join("\n\n");
    },
};
