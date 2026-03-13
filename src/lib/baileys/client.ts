import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState as loadMultiFileAuthState,
    makeCacheableSignalKeyStore,
    WASocket,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { ChannelHealthStatus, UsageMetric } from "@prisma/client";
import { Boom } from "@hapi/boom";
import pino from "pino";
import path from "path";
import fs from "fs";
import os from "os";
import { channelRepo } from "@/lib/db/channelRepo";
import { billingService } from "@/lib/billing/service";
import {
    clearLatestQr,
    emitConnectionUpdate,
    emitNewMessage,
    emitQr,
    WAConnectionStatus,
    WAHealthStatus,
} from "./events";
import { getInboundMessageQueue } from "../queue/messageQueue";
import { enqueueInboundWithDebounce } from "../queue/inboundDebounce";
import { sessionRepo } from "../db/sessionRepo";
import { getDefaultTenantContext } from "../tenant/context";
import { withObservationContext } from "@/lib/observability/context";
import { logError, logInfo } from "@/lib/observability/logger";
import { generateCorrelationId, generateTraceId } from "@/lib/observability/trace";

const logger = pino({ level: "silent" });
const MAX_RETRIES = 5;
const QR_TTL_MS = 60_000;
const DEFAULT_AUTH_ROOT_DIR = path.join(os.tmpdir(), "wa-gateway-auth", "channels");
const AUTH_ROOT_DIR = process.env.WA_AUTH_ROOT_DIR?.trim()
    ? path.resolve(process.env.WA_AUTH_ROOT_DIR.trim())
    : DEFAULT_AUTH_ROOT_DIR;

type ChannelRuntimeState = {
    channelId: string;
    workspaceId: string;
    sock: WASocket | null;
    status: WAConnectionStatus;
    retryCount: number;
    manualDisconnectInProgress: boolean;
    recentlySentMessageIds: Set<string>;
    connectLock?: Promise<void>;
};

const channelRuntime = new Map<string, ChannelRuntimeState>();

function ensureDir(pathName: string) {
    if (!fs.existsSync(pathName)) {
        fs.mkdirSync(pathName, { recursive: true });
    }
}

function normalizeJid(jid: string): string {
    const [left, right] = jid.split("@");
    if (!left || !right) return jid;
    return `${left.split(":")[0]}@${right}`;
}

function toRecipientJid(identifier: string): string {
    if (identifier.includes("@")) {
        return normalizeJid(identifier);
    }
    return `${identifier}@s.whatsapp.net`;
}

function toPhoneIdentifier(remoteJid: string): string {
    if (remoteJid.endsWith("@s.whatsapp.net")) {
        return remoteJid.replace("@s.whatsapp.net", "");
    }
    if (remoteJid.includes("@")) {
        return normalizeJid(remoteJid);
    }
    return remoteJid;
}

function getMessageText(msg: {
    message?: {
        conversation?: string | null;
        extendedTextMessage?: { text?: string | null } | null;
    } | null;
}): string {
    return msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
}

function hasMediaPayload(msg: {
    message?: Record<string, unknown> | null;
}): boolean {
    const message = msg.message;
    if (!message || typeof message !== "object") {
        return false;
    }

    return Boolean(
        message.imageMessage
        || message.videoMessage
        || message.audioMessage
        || message.documentMessage
        || message.stickerMessage
    );
}

function getAuthDir(channelId: string) {
    return path.join(AUTH_ROOT_DIR, channelId);
}

function authStateSessionKey(channelId: string) {
    return `wa:${channelId}:auth-state`;
}

function qrSessionKey(channelId: string) {
    return `wa:${channelId}:latest-qr`;
}

function qrExpirySessionKey(channelId: string) {
    return `wa:${channelId}:latest-qr-expiry`;
}

function statusSessionKey(channelId: string) {
    return `wa:${channelId}:connection-status`;
}

function mapHealthStatus(status: WAConnectionStatus, reasonCode?: number | null): WAHealthStatus {
    if (status === "open") {
        return "connected";
    }
    if (status === "connecting") {
        return "degraded";
    }
    if (reasonCode === DisconnectReason.restartRequired) {
        return "degraded";
    }
    if (reasonCode === 401 || reasonCode === 403) {
        return "banned-risk";
    }
    return "disconnected";
}

function toDbHealthStatus(status: WAHealthStatus): ChannelHealthStatus {
    if (status === "connected") return ChannelHealthStatus.CONNECTED;
    if (status === "degraded") return ChannelHealthStatus.DEGRADED;
    if (status === "banned-risk") return ChannelHealthStatus.BANNED_RISK;
    return ChannelHealthStatus.DISCONNECTED;
}

function healthScore(status: WAHealthStatus): number {
    if (status === "connected") return 100;
    if (status === "degraded") return 60;
    if (status === "banned-risk") return 20;
    return 30;
}

function getOrCreateRuntime(channelId: string, workspaceId: string): ChannelRuntimeState {
    const existing = channelRuntime.get(channelId);
    if (existing) {
        existing.workspaceId = workspaceId;
        return existing;
    }

    const runtime: ChannelRuntimeState = {
        channelId,
        workspaceId,
        sock: null,
        status: "close",
        retryCount: 0,
        manualDisconnectInProgress: false,
        recentlySentMessageIds: new Set<string>(),
    };

    channelRuntime.set(channelId, runtime);
    return runtime;
}

function trackSentMessage(runtime: ChannelRuntimeState, messageId?: string | null) {
    if (!messageId) return;
    runtime.recentlySentMessageIds.add(messageId);
    setTimeout(() => {
        runtime.recentlySentMessageIds.delete(messageId);
    }, 120_000);
}

async function restoreAuthFromDb(channelId: string): Promise<void> {
    const session = await sessionRepo.getSession(authStateSessionKey(channelId));
    if (!session?.data) return;

    const authDir = getAuthDir(channelId);
    ensureDir(authDir);

    const files = JSON.parse(session.data) as Record<string, string>;
    for (const [fileName, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(authDir, fileName), content, "utf-8");
    }
}

function listAuthFiles(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath).filter((entry) => {
        const fullPath = path.join(dirPath, entry);
        return fs.statSync(fullPath).isFile();
    });
}

async function backupAuthToDb(channelId: string): Promise<void> {
    const authDir = getAuthDir(channelId);
    ensureDir(authDir);
    const files = listAuthFiles(authDir);
    const payload: Record<string, string> = {};

    for (const fileName of files) {
        payload[fileName] = fs.readFileSync(path.join(authDir, fileName), "utf-8");
    }

    await sessionRepo.saveSession(authStateSessionKey(channelId), JSON.stringify(payload));
}

async function clearAuthState(channelId: string): Promise<void> {
    const authDir = getAuthDir(channelId);
    if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true });
    }

    await Promise.all([
        sessionRepo.deleteSession(authStateSessionKey(channelId)),
        sessionRepo.deleteSession(qrSessionKey(channelId)),
        sessionRepo.deleteSession(qrExpirySessionKey(channelId)),
        sessionRepo.saveSession(statusSessionKey(channelId), "close"),
    ]);

    clearLatestQr(channelId);
}

async function persistConnectionStatus(channelId: string, status: WAConnectionStatus) {
    await sessionRepo.saveSession(statusSessionKey(channelId), status);
}

function getOwnJid(sock: WASocket | null): string | null {
    const raw = sock?.user?.id;
    if (!raw) return null;

    const [left, server] = raw.split("@");
    if (!left || !server) return null;

    const user = left.split(":")[0];
    return `${user}@${server}`;
}

async function handleManualOperatorMessage(runtime: ChannelRuntimeState, remoteJid: string, messageText: string): Promise<void> {
    const phoneNumber = toPhoneIdentifier(remoteJid);
    if (!phoneNumber) return;

    const [{ userRepo }, { messageRepo }, { handoverRepo }] = await Promise.all([
        import("../db/userRepo"),
        import("../db/messageRepo"),
        import("../handover/repo"),
    ]);

    const user = await userRepo.upsertUser(phoneNumber, runtime.workspaceId, undefined);

    if (messageText.trim()) {
        await messageRepo.saveMessage({
            workspaceId: runtime.workspaceId,
            userId: user.id,
            role: "assistant",
            content: messageText,
            metadata: {
                source: "human-operator",
                channelId: runtime.channelId,
            },
        });
    }

    await handoverRepo.clearPending(phoneNumber, runtime.workspaceId);
}

function attachSocketEventHandlers(
    runtime: ChannelRuntimeState,
    sock: WASocket,
    saveCreds: () => Promise<void>
) {
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            const expiresAt = Date.now() + QR_TTL_MS;
            await Promise.all([
                sessionRepo.saveSession(qrSessionKey(runtime.channelId), qr),
                sessionRepo.saveSession(qrExpirySessionKey(runtime.channelId), String(expiresAt)),
                channelRepo.createAudit(runtime.channelId, {
                    eventType: "qr_generated",
                    status: "info",
                    metadata: { expiresAt },
                }),
            ]);

            emitQr({
                workspaceId: runtime.workspaceId,
                channelId: runtime.channelId,
                qr,
                expiresAt,
            });
        }

        if (connection === "connecting") {
            runtime.status = "connecting";
            await persistConnectionStatus(runtime.channelId, "connecting");

            const health = mapHealthStatus("connecting", null);
            emitConnectionUpdate({
                workspaceId: runtime.workspaceId,
                channelId: runtime.channelId,
                status: "connecting",
                healthStatus: health,
            });

            await channelRepo.updateHealth(runtime.channelId, {
                healthStatus: toDbHealthStatus(health),
                healthScore: healthScore(health),
                status: "connecting",
            });
            return;
        }

        if (connection === "open") {
            runtime.status = "open";
            runtime.retryCount = 0;

            await Promise.all([
                persistConnectionStatus(runtime.channelId, "open"),
                sessionRepo.deleteSession(qrSessionKey(runtime.channelId)),
                sessionRepo.deleteSession(qrExpirySessionKey(runtime.channelId)),
            ]);

            clearLatestQr(runtime.channelId);

            const health = mapHealthStatus("open", null);
            emitConnectionUpdate({
                workspaceId: runtime.workspaceId,
                channelId: runtime.channelId,
                status: "open",
                healthStatus: health,
            });

            await channelRepo.updateHealth(runtime.channelId, {
                healthStatus: toDbHealthStatus(health),
                healthScore: healthScore(health),
                status: "active",
                markSeen: true,
            });

            await channelRepo.createAudit(runtime.channelId, {
                eventType: "connected",
                status: "success",
                message: "Channel connected",
            });

            return;
        }

        if (connection === "close") {
            runtime.status = "close";
            runtime.sock = null;
            await persistConnectionStatus(runtime.channelId, "close");

            const reasonCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const restartRequired = reasonCode === DisconnectReason.restartRequired;
            const manual = runtime.manualDisconnectInProgress;
            runtime.manualDisconnectInProgress = false;
            const health = mapHealthStatus("close", reasonCode);

            emitConnectionUpdate({
                workspaceId: runtime.workspaceId,
                channelId: runtime.channelId,
                status: "close",
                healthStatus: health,
                message: manual
                    ? "manual_disconnect"
                    : restartRequired
                        ? "restart_required"
                        : reasonCode ? `reason:${reasonCode}` : undefined,
            });

            await channelRepo.updateHealth(runtime.channelId, {
                healthStatus: toDbHealthStatus(health),
                healthScore: healthScore(health),
                status: manual ? "inactive" : (restartRequired ? "connecting" : "active"),
                message: restartRequired ? undefined : (reasonCode ? `reason:${reasonCode}` : undefined),
            });

            await channelRepo.createAudit(runtime.channelId, {
                eventType: manual
                    ? "manual_disconnect"
                    : restartRequired
                        ? "restart_required"
                        : "connection_closed",
                status: manual
                    ? "success"
                    : restartRequired
                        ? "info"
                        : health,
                message: restartRequired ? "reason:restart_required" : (reasonCode ? `reason:${reasonCode}` : undefined),
            });

            if (manual) {
                return;
            }

            if (reasonCode === DisconnectReason.loggedOut) {
                await clearAuthState(runtime.channelId);
            }

            if (restartRequired) {
                setTimeout(() => {
                    void connectToWhatsApp(runtime.channelId);
                }, 200);
                return;
            }

            if (runtime.retryCount < MAX_RETRIES) {
                runtime.retryCount += 1;
                const delay = Math.min(1000 * Math.pow(2, runtime.retryCount), 30_000);
                setTimeout(() => {
                    void connectToWhatsApp(runtime.channelId);
                }, delay);
            }
        }
    });

    sock.ev.on("creds.update", async () => {
        await saveCreds();
        await backupAuthToDb(runtime.channelId);
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

        for (const msg of messages) {
            const remoteJid = msg.key.remoteJid ?? "";
            const messageText = getMessageText(msg);
            const mediaDetected = hasMediaPayload(msg as { message?: Record<string, unknown> | null });

            if (msg.key.fromMe) {
                const ownJid = getOwnJid(runtime.sock);
                const isSelfChat = Boolean(ownJid) && remoteJid === ownJid;
                const sentByGateway = Boolean(msg.key.id) && runtime.recentlySentMessageIds.has(msg.key.id as string);

                if (sentByGateway) {
                    continue;
                }

                if (!isSelfChat) {
                    try {
                        await handleManualOperatorMessage(runtime, remoteJid, messageText);
                    } catch (error) {
                        logError("wa.manual_operator_message.process_failed", error, {
                            workspaceId: runtime.workspaceId,
                            channelId: runtime.channelId,
                        });
                    }
                    continue;
                }
            }

            if (remoteJid.endsWith("@g.us")) continue;
            if (remoteJid === "status@broadcast") continue;

            const phoneNumber = toPhoneIdentifier(remoteJid);

            if (mediaDetected && phoneNumber) {
                await billingService.recordUsageEvent({
                    workspaceId: runtime.workspaceId,
                    channelId: runtime.channelId,
                    metric: UsageMetric.MEDIA_IN,
                    quantity: 1,
                    referenceId: phoneNumber,
                    metadata: {
                        source: "wa-media-in",
                    },
                });
            }

            if (!messageText || !phoneNumber) continue;

            const messageId = msg.key.id ?? "";
            const correlationId = generateCorrelationId();
            const traceId = generateTraceId();
            const pushName = msg.pushName ?? undefined;
            const timestamp = typeof msg.messageTimestamp === "number"
                ? msg.messageTimestamp
                : Date.now() / 1000;

            await withObservationContext({
                correlationId,
                traceId,
                workspaceId: runtime.workspaceId,
                channelId: runtime.channelId,
                messageId,
                component: "baileys",
            }, async () => {
                emitNewMessage({
                    workspaceId: runtime.workspaceId,
                    channelId: runtime.channelId,
                    phoneNumber,
                    messageText,
                    messageId,
                    pushName,
                    timestamp,
                });

                const inboundQueue = getInboundMessageQueue(runtime.workspaceId, runtime.channelId);
                await enqueueInboundWithDebounce(inboundQueue, {
                    workspaceId: runtime.workspaceId,
                    channelId: runtime.channelId,
                    phoneNumber,
                    messageText,
                    messageId,
                    timestamp,
                    pushName,
                    enqueuedAt: Date.now(),
                    correlationId,
                    traceId,
                });

                logInfo("pipeline.wa.inbound_enqueued", {
                    queueName: inboundQueue.name,
                    phoneNumber,
                });
            });
        }
    });
}

async function connectSingleChannel(channelId: string): Promise<void> {
    const channel = await channelRepo.getChannelById(channelId);
    if (!channel || !channel.isEnabled || channel.status === "removed" || !channel.workspace?.isActive) {
        return;
    }

    const runtime = getOrCreateRuntime(channel.id, channel.workspaceId);
    if (runtime.sock && runtime.status !== "close") {
        return;
    }

    const authDir = getAuthDir(channel.id);
    ensureDir(authDir);
    await restoreAuthFromDb(channel.id);

    const { state, saveCreds } = await loadMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        logger,
        generateHighQualityLinkPreview: false,
    });

    runtime.sock = sock;
    runtime.status = "connecting";

    attachSocketEventHandlers(runtime, sock, saveCreds);

    emitConnectionUpdate({
        workspaceId: runtime.workspaceId,
        channelId: runtime.channelId,
        status: "connecting",
        healthStatus: "degraded",
        message: "initial_connect",
    });
}

export async function connectToWhatsApp(channelId?: string): Promise<void> {
    if (channelId) {
        const runtime = channelRuntime.get(channelId);
        if (runtime?.connectLock) {
            return runtime.connectLock;
        }

        const lock = (async () => {
            try {
                await connectSingleChannel(channelId);
            } catch (error) {
                logError("wa.connect.failed", error, {
                    channelId,
                });
                const runtimeState = channelRuntime.get(channelId);
                if (runtimeState) {
                    runtimeState.status = "close";
                }
            } finally {
                const runtimeState = channelRuntime.get(channelId);
                if (runtimeState) {
                    runtimeState.connectLock = undefined;
                }
            }
        })();

        const state = channelRuntime.get(channelId) || getOrCreateRuntime(channelId, getDefaultTenantContext().workspaceId);
        state.connectLock = lock;
        return lock;
    }

    const channels = await channelRepo.listActiveRuntimeChannels();
    if (channels.length === 0) {
        const tenant = getDefaultTenantContext();
        await connectToWhatsApp(tenant.channelId);
        return;
    }

    await Promise.all(channels.map((channel) => connectToWhatsApp(channel.id)));
}

async function resolveChannelIdForSend(input?: { channelId?: string; workspaceId?: string }): Promise<string> {
    if (input?.channelId) {
        return input.channelId;
    }

    if (input?.workspaceId) {
        const primary = await channelRepo.getPrimaryWorkspaceChannel(input.workspaceId);
        if (primary) {
            return primary.id;
        }
    }

    const fallback = getDefaultTenantContext().channelId;
    return fallback;
}

function getSocketByChannelId(channelId: string): WASocket | null {
    return channelRuntime.get(channelId)?.sock ?? null;
}

export function getSocket(channelId?: string): WASocket | null {
    if (channelId) {
        return getSocketByChannelId(channelId);
    }

    const tenant = getDefaultTenantContext();
    return getSocketByChannelId(tenant.channelId);
}

export function getConnectionStatus(channelId?: string): WAConnectionStatus {
    if (channelId) {
        return channelRuntime.get(channelId)?.status ?? "close";
    }

    const tenant = getDefaultTenantContext();
    return channelRuntime.get(tenant.channelId)?.status ?? "close";
}

export async function sendMessage(
    phoneNumber: string,
    text: string,
    options?: { withTyping?: boolean; channelId?: string; workspaceId?: string }
): Promise<void> {
    const resolvedChannelId = await resolveChannelIdForSend({
        channelId: options?.channelId,
        workspaceId: options?.workspaceId,
    });

    await connectToWhatsApp(resolvedChannelId);
    const runtime = channelRuntime.get(resolvedChannelId);
    const sock = runtime?.sock;

    if (!runtime || !sock) {
        throw new Error(`[WA] Channel socket not connected (${resolvedChannelId})`);
    }

    const jid = toRecipientJid(phoneNumber);

    if (options?.withTyping ?? true) {
        await sendTyping(phoneNumber, text.length, { channelId: resolvedChannelId });
    }

    const sent = await sock.sendMessage(jid, { text });
    trackSentMessage(runtime, sent?.key?.id);
}

export async function sendTyping(
    phoneNumber: string,
    textLength: number = 30,
    options?: { channelId?: string; workspaceId?: string }
): Promise<void> {
    const resolvedChannelId = await resolveChannelIdForSend({
        channelId: options?.channelId,
        workspaceId: options?.workspaceId,
    });

    await connectToWhatsApp(resolvedChannelId);
    const sock = channelRuntime.get(resolvedChannelId)?.sock;
    if (!sock) {
        throw new Error(`[WA] Channel socket not connected (${resolvedChannelId})`);
    }

    const jid = toRecipientJid(phoneNumber);
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate("composing", jid);

    const delay = Math.min(textLength * 50, 3000);
    await new Promise((resolve) => setTimeout(resolve, delay));
    await sock.sendPresenceUpdate("paused", jid);
}

export async function sendOperatorReport(
    text: string,
    options?: { channelId?: string; workspaceId?: string }
): Promise<void> {
    const resolvedChannelId = await resolveChannelIdForSend(options);
    await connectToWhatsApp(resolvedChannelId);
    const runtime = channelRuntime.get(resolvedChannelId);
    const sock = runtime?.sock;

    if (!runtime || !sock) {
        console.error(`[WA] Cannot send operator report: socket not connected (${resolvedChannelId})`);
        return;
    }

    const ownJid = getOwnJid(sock);
    if (!ownJid) {
        console.error("[WA] Cannot send operator report: own JID not available");
        return;
    }

    const sent = await sock.sendMessage(ownJid, { text });
    trackSentMessage(runtime, sent?.key?.id);
}

export async function disconnectWhatsApp(
    channelId?: string,
    options?: { clearSession?: boolean }
): Promise<void> {
    const clearSession = options?.clearSession ?? false;

    const channelIds = channelId
        ? [channelId]
        : Array.from(channelRuntime.keys());

    await Promise.all(channelIds.map(async (id) => {
        const runtime = channelRuntime.get(id);
        if (!runtime) {
            if (clearSession) {
                await clearAuthState(id);
            }
            return;
        }

        if (runtime.sock) {
            runtime.manualDisconnectInProgress = true;
            try {
                await runtime.sock.logout();
            } catch {
                // noop
            }
            runtime.sock = null;
        }

        runtime.status = "close";
        await persistConnectionStatus(id, "close");

        emitConnectionUpdate({
            workspaceId: runtime.workspaceId,
            channelId: runtime.channelId,
            status: "close",
            healthStatus: "disconnected",
            message: clearSession ? "manual_disconnect_clear_session" : "manual_disconnect",
        });

        await channelRepo.updateHealth(id, {
            healthStatus: ChannelHealthStatus.DISCONNECTED,
            healthScore: 30,
            status: clearSession ? "inactive" : "active",
            message: clearSession ? "session_cleared" : "manual_disconnect",
        });

        await channelRepo.createAudit(id, {
            eventType: clearSession ? "manual_disconnect_clear_session" : "manual_disconnect",
            status: "success",
        });

        if (clearSession) {
            await clearAuthState(id);
        }
    }));
}

export async function getWorkspaceChannelRuntimeStatus(
    workspaceId: string,
    options?: { provider?: string }
) {
    const channels = await channelRepo.listWorkspaceChannels(workspaceId, {
        provider: options?.provider,
    });

    const statusSessions = await Promise.all(channels.map((channel) => sessionRepo.getSession(statusSessionKey(channel.id))));
    const qrSessions = await Promise.all(channels.map((channel) => sessionRepo.getSession(qrSessionKey(channel.id))));
    const qrExpirySessions = await Promise.all(channels.map((channel) => sessionRepo.getSession(qrExpirySessionKey(channel.id))));

    return channels.map((channel, index) => {
        const runtimeStatus = channelRuntime.get(channel.id)?.status;
        const persistedStatus = statusSessions[index]?.data;
        const status: WAConnectionStatus = runtimeStatus
            || (persistedStatus === "open" || persistedStatus === "close" || persistedStatus === "connecting"
                ? persistedStatus
                : "close");
        const qr = qrSessions[index]?.data || null;
        const qrExpiryRaw = qrExpirySessions[index]?.data;
        const qrExpiresAt = qrExpiryRaw ? Number(qrExpiryRaw) : null;

        return {
            channelId: channel.id,
            workspaceId,
            name: channel.name,
            provider: channel.provider,
            identifier: channel.identifier,
            status,
            isEnabled: channel.isEnabled,
            isPrimary: channel.isPrimary,
            healthStatus: channel.healthStatus,
            healthScore: channel.healthScore,
            rateLimitPerSecond: channel.rateLimitPerSecond,
            lastSeenAt: channel.lastSeenAt,
            lastError: channel.lastError,
            qr,
            qrExpiresAt,
            hasAuthState: Boolean(qrSessions[index]?.data || statusSessions[index]?.data),
            policy: channel.policy,
        };
    });
}
