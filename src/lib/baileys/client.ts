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
import { waEvents } from "./events";
import { messageQueue } from "../queue/messageQueue";
import { sessionRepo } from "../db/sessionRepo";

const logger = pino({ level: "silent" });

let sock: WASocket | null = null;
let connectionStatus: "open" | "close" | "connecting" = "close";
let retryCount = 0;
const MAX_RETRIES = 5;

const AUTH_DIR = path.join(process.cwd(), ".wa-auth");
const SESSION_ID = process.env.WA_SESSION_ID || "main-session";

function ensureDir(pathName: string) {
    if (!fs.existsSync(pathName)) {
        fs.mkdirSync(pathName, { recursive: true });
    }
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
        printQRInTerminal: true,
        generateHighQualityLinkPreview: false,
    });

    // Connection update handler
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("[WA] QR Code generated");
            waEvents.emit("qr", qr);
        }

        if (connection === "close") {
            connectionStatus = "close";
            waEvents.emit("connection-update", { status: "close" });

            const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;

            if (shouldReconnect && retryCount < MAX_RETRIES) {
                retryCount++;
                const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
                console.log(`[WA] Reconnecting in ${delay / 1000}s (attempt ${retryCount}/${MAX_RETRIES})...`);
                setTimeout(connectToWhatsApp, delay);
            } else if (reason === DisconnectReason.loggedOut) {
                console.log("[WA] Session logged out. Please scan QR code again.");
                retryCount = 0;
                await sessionRepo.deleteSession(SESSION_ID);
            } else {
                console.error("[WA] Max retries reached. Please restart manually.");
            }
        }

        if (connection === "open") {
            connectionStatus = "open";
            retryCount = 0;
            console.log("[WA] Connected successfully!");
            waEvents.emit("connection-update", { status: "open" });
        }

        if (connection === "connecting") {
            connectionStatus = "connecting";
            waEvents.emit("connection-update", { status: "connecting" });
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
            // Ignore self messages
            if (msg.key.fromMe) continue;

            // Ignore group messages (optional — uncomment to allow groups)
            if (msg.key.remoteJid?.endsWith("@g.us")) continue;

            // Ignore status broadcasts
            if (msg.key.remoteJid === "status@broadcast") continue;

            const phoneNumber = msg.key.remoteJid?.replace("@s.whatsapp.net", "") ?? "";
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
            waEvents.emit("new-message", {
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

    const jid = `${phoneNumber}@s.whatsapp.net`;

    await sendTyping(phoneNumber, text.length);
    await sock.sendMessage(jid, { text });
}

export async function sendTyping(phoneNumber: string, textLength: number = 30): Promise<void> {
    if (!sock) {
        throw new Error("[WA] Socket not connected");
    }

    const jid = `${phoneNumber}@s.whatsapp.net`;
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate("composing", jid);

    const delay = Math.min(textLength * 50, 3000);
    await new Promise((resolve) => setTimeout(resolve, delay));
    await sock.sendPresenceUpdate("paused", jid);
}

export async function disconnectWhatsApp(): Promise<void> {
    if (sock) {
        await sock.logout();
        sock = null;
        connectionStatus = "close";
        if (fs.existsSync(AUTH_DIR)) {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        }
        await sessionRepo.deleteSession(SESSION_ID);
        console.log("[WA] Disconnected");
    }
}
