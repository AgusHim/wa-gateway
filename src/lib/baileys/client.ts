import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState as loadMultiFileAuthState,
    makeCacheableSignalKeyStore,
    WASocket,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import path from "path";
import fs from "fs";
import { clearLatestQr, emitConnectionUpdate, emitNewMessage, emitQr } from "./events";
import { messageQueue } from "../queue/messageQueue";
import { sessionRepo } from "../db/sessionRepo";

const logger = pino({ level: "silent" });

let sock: WASocket | null = null;
let connectionStatus: "open" | "close" | "connecting" = "close";
let retryCount = 0;
const MAX_RETRIES = 5;
let manualDisconnectInProgress = false;
const recentlySentMessageIds = new Set<string>();

const AUTH_DIR = path.join(process.cwd(), ".wa-auth");
const SESSION_ID = process.env.WA_SESSION_ID || "main-session";
const QR_SESSION_ID = `${SESSION_ID}:latest-qr`;
const STATUS_SESSION_ID = `${SESSION_ID}:connection-status`;

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

function listAuthFiles(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath).filter((entry) => {
        const fullPath = path.join(dirPath, entry);
        return fs.statSync(fullPath).isFile();
    });
}

async function restoreAuthFromDb(): Promise<void> {
    const session = await sessionRepo.getSession(SESSION_ID);
    if (!session?.data) return;

    ensureDir(AUTH_DIR);
    const files = JSON.parse(session.data) as Record<string, string>;

    for (const [fileName, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(AUTH_DIR, fileName), content, "utf-8");
    }
}

async function backupAuthToDb(): Promise<void> {
    ensureDir(AUTH_DIR);
    const files = listAuthFiles(AUTH_DIR);
    const payload: Record<string, string> = {};

    for (const fileName of files) {
        payload[fileName] = fs.readFileSync(path.join(AUTH_DIR, fileName), "utf-8");
    }

    await sessionRepo.saveSession(SESSION_ID, JSON.stringify(payload));
}

async function persistConnectionStatus(status: "open" | "close" | "connecting") {
    await sessionRepo.saveSession(STATUS_SESSION_ID, status);
}

function trackSentMessage(messageId?: string | null) {
    if (!messageId) return;
    recentlySentMessageIds.add(messageId);
    setTimeout(() => {
        recentlySentMessageIds.delete(messageId);
    }, 120000);
}

async function clearAuthState(): Promise<void> {
    if (fs.existsSync(AUTH_DIR)) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
    await sessionRepo.deleteSession(SESSION_ID);
    await sessionRepo.deleteSession(QR_SESSION_ID);
    await sessionRepo.saveSession(STATUS_SESSION_ID, "close");
    clearLatestQr();
}

export function getConnectionStatus() {
    return connectionStatus;
}

export function getSocket(): WASocket | null {
    return sock;
}

export async function connectToWhatsApp(): Promise<void> {
    await restoreAuthFromDb();
    const { state, saveCreds } = await loadMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        logger,
        generateHighQualityLinkPreview: false,
    });

    // Connection update handler
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("[WA] QR Code generated");
            await sessionRepo.saveSession(QR_SESSION_ID, qr);
            emitQr(qr);
        }

        if (connection === "close") {
            connectionStatus = "close";
            await persistConnectionStatus("close");
            const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const manual = manualDisconnectInProgress;
            manualDisconnectInProgress = false;
            emitConnectionUpdate({
                status: "close",
                message: manual
                    ? "manual_disconnect"
                    : reason ? `reason:${reason}` : undefined,
            });

            if (manual) {
                console.log("[WA] Connection closed by manual disconnect.");
                return;
            }

            if (reason === DisconnectReason.loggedOut) {
                console.log("[WA] Session logged out. Clearing auth state and requesting new QR.");
                await clearAuthState();
            }

            if (retryCount < MAX_RETRIES) {
                retryCount++;
                const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
                console.log(`[WA] Reconnecting in ${delay / 1000}s (attempt ${retryCount}/${MAX_RETRIES})...`);
                setTimeout(connectToWhatsApp, delay);
            } else {
                console.error("[WA] Max retries reached. Cooling down for 30s before retrying...");
                retryCount = 0;
                setTimeout(connectToWhatsApp, 30000);
            }
        }

        if (connection === "open") {
            connectionStatus = "open";
            await persistConnectionStatus("open");
            retryCount = 0;
            clearLatestQr();
            await sessionRepo.deleteSession(QR_SESSION_ID);
            console.log("[WA] Connected successfully!");
            emitConnectionUpdate({ status: "open" });
        }

        if (connection === "connecting") {
            connectionStatus = "connecting";
            await persistConnectionStatus("connecting");
            emitConnectionUpdate({ status: "connecting" });
        }
    });

    // Save credentials on update
    sock.ev.on("creds.update", async () => {
        await saveCreds();
        await backupAuthToDb();
    });

    // Message handler
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

        for (const msg of messages) {
            // Allow self-chat testing:
            // - process messages from connected number only in self-chat
            // - ignore messages that were sent by this gateway to avoid loops
            if (msg.key.fromMe) {
                const ownJid = getOwnJid();
                const isSelfChat = Boolean(ownJid) && msg.key.remoteJid === ownJid;
                const sentByGateway = Boolean(msg.key.id) && recentlySentMessageIds.has(msg.key.id as string);

                if (sentByGateway || !isSelfChat) {
                    continue;
                }
            }

            // Ignore group messages (optional — uncomment to allow groups)
            if (msg.key.remoteJid?.endsWith("@g.us")) continue;

            // Ignore status broadcasts
            if (msg.key.remoteJid === "status@broadcast") continue;

            const remoteJid = msg.key.remoteJid ?? "";
            let phoneNumber = remoteJid;
            if (remoteJid.endsWith("@s.whatsapp.net")) {
                phoneNumber = remoteJid.replace("@s.whatsapp.net", "");
            } else if (remoteJid.includes("@")) {
                // Keep non-phone JIDs (e.g. @lid) as-is so reply routing stays valid.
                phoneNumber = normalizeJid(remoteJid);
            }
            const messageText =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                "";

            if (!messageText || !phoneNumber) continue;

            const messageId = msg.key.id ?? "";
            const pushName = msg.pushName ?? undefined;
            const timestamp = typeof msg.messageTimestamp === "number"
                ? msg.messageTimestamp
                : Date.now() / 1000;

            console.log(`[WA] Message from ${phoneNumber}: ${messageText.substring(0, 50)}...`);

            // Emit event for live monitor
            emitNewMessage({
                phoneNumber,
                messageText,
                messageId,
                pushName,
                timestamp,
            });

            // Enqueue to BullMQ
            await messageQueue.add("inbound", {
                phoneNumber,
                messageText,
                messageId,
                timestamp,
                pushName,
            });
        }
    });
}

export async function sendMessage(phoneNumber: string, text: string): Promise<void> {
    if (!sock) {
        throw new Error("[WA] Socket not connected");
    }

    const jid = toRecipientJid(phoneNumber);

    await sendTyping(phoneNumber, text.length);
    const sent = await sock.sendMessage(jid, { text });
    trackSentMessage(sent?.key?.id);
}

export async function sendTyping(phoneNumber: string, textLength: number = 30): Promise<void> {
    if (!sock) {
        throw new Error("[WA] Socket not connected");
    }

    const jid = toRecipientJid(phoneNumber);
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate("composing", jid);

    const delay = Math.min(textLength * 50, 3000);
    await new Promise((resolve) => setTimeout(resolve, delay));
    await sock.sendPresenceUpdate("paused", jid);
}

function getOwnJid(): string | null {
    const raw = sock?.user?.id;
    if (!raw) return null;

    // Baileys user id can include device suffix (e.g. 628xx:12@s.whatsapp.net)
    const [left, server] = raw.split("@");
    if (!left || !server) return null;

    const user = left.split(":")[0];
    return `${user}@${server}`;
}

export async function sendOperatorReport(text: string): Promise<void> {
    if (!sock) {
        console.error("[WA] Cannot send operator report: socket not connected");
        return;
    }

    const ownJid = getOwnJid();
    if (!ownJid) {
        console.error("[WA] Cannot send operator report: own JID not available");
        return;
    }

    const sent = await sock.sendMessage(ownJid, { text });
    trackSentMessage(sent?.key?.id);
}

export async function disconnectWhatsApp(): Promise<void> {
    if (sock) {
        manualDisconnectInProgress = true;
        await sock.logout();
        sock = null;
    }
    connectionStatus = "close";
    await persistConnectionStatus("close");
    emitConnectionUpdate({ status: "close", message: "manual_disconnect" });
    await clearAuthState();
    console.log("[WA] Disconnected and auth state cleared");
}
