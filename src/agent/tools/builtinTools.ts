import { Tool } from "./registry";
import { userRepo } from "../../lib/db/userRepo";
import { memoryRepo } from "../../lib/db/memoryRepo";

const DEFAULT_SMARTSCHOLAR_API_BASE_URL =
    process.env.SMARTSCHOLAR_API_BASE_URL || "https://api.smartscholar.id";
const ALLOWED_SMARTSCHOLAR_HOSTS = (
    process.env.SMARTSCHOLAR_API_ALLOWED_HOSTS || "api.smartscholar.id"
)
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
const MAX_HTTP_BODY_CHARS = 4000;
const ALLOWED_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

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
    execute: async (params) => {
        const user = await userRepo.getUserByPhone(params.phoneNumber);
        if (!user) {
            return "User tidak ditemukan di database.";
        }

        const memories = await memoryRepo.getMemoriesByUser(user.id) as Array<{ key: string; value: string }>;
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
            userId: context.userId,
            key: params.key,
            value: params.value,
        });
        return `Berhasil menyimpan: ${params.key} = ${params.value}`;
    },
};

function resolveSmartScholarUrl(endpoint: string, query?: string): URL {
    const target = endpoint.trim();
    const url = target.startsWith("http://") || target.startsWith("https://")
        ? new URL(target)
        : new URL(target, DEFAULT_SMARTSCHOLAR_API_BASE_URL);

    const host = url.host.toLowerCase();
    if (!ALLOWED_SMARTSCHOLAR_HOSTS.includes(host)) {
        throw new Error(
            `Host "${url.host}" tidak diizinkan. Host yang diizinkan: ${ALLOWED_SMARTSCHOLAR_HOSTS.join(", ")}`
        );
    }

    if (query?.trim()) {
        const queryParams = new URLSearchParams(query.trim());
        queryParams.forEach((value, key) => {
            url.searchParams.set(key, value);
        });
    }

    return url;
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

function getAuthHeaders(authMode?: string): Record<string, string> {
    const mode = (authMode || "auto").trim().toLowerCase();
    const headers: Record<string, string> = {};

    const bearerToken = process.env.SMARTSCHOLAR_API_BEARER_TOKEN?.trim();
    const cookie = process.env.SMARTSCHOLAR_ADMIN_COOKIE?.trim();
    const apiKey = process.env.SMARTSCHOLAR_ADMIN_API_KEY?.trim();

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
    execute: async (params) => {
        const method = normalizeMethod(params.method);
        const url = resolveSmartScholarUrl(params.endpoint, params.query);
        const mode = (params.authMode || "auto").trim().toLowerCase();
        const baseHeaders: Record<string, string> = {
            Accept: "application/json, text/plain, */*",
            "User-Agent": "wa-gateway-agent/1.0",
        };
        const authHeaders = mode === "none" ? {} : getAuthHeaders(mode);
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
