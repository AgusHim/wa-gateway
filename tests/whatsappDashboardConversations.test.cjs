const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  extractWhatsAppMediaDescriptor,
} = require("../src/lib/baileys/media");
const {
  getPrivateMediaInfo,
  buildCloudflareR2Endpoint,
  isAllowedInboundMime,
  resolveMediaStorageDriver,
  sanitizeMediaFileName,
  storePrivateMedia,
} = require("../src/lib/media/storage");
const {
  isValidIdempotencyKey,
  parseByteRange,
} = require("../src/lib/conversations/validation");

test("extracts WhatsApp document metadata and caption", () => {
  const descriptor = extractWhatsAppMediaDescriptor({
    documentMessage: {
      fileName: "invoice.pdf",
      mimetype: "application/pdf",
      fileLength: 2048,
      caption: "Invoice terbaru",
    },
  });

  assert.deepEqual(descriptor, {
    type: "document",
    caption: "Invoice terbaru",
    fileName: "invoice.pdf",
    mimeType: "application/pdf",
    declaredByteSize: 2048,
    isAnimated: false,
  });
});

test("extracts audio and animated sticker metadata", () => {
  const audio = extractWhatsAppMediaDescriptor({
    audioMessage: {
      mimetype: "audio/ogg; codecs=opus",
      fileLength: 4096,
      seconds: 12,
      ptt: true,
    },
  });
  assert.equal(audio.type, "audio");
  assert.equal(audio.fileName, "voice-note.ogg");
  assert.equal(audio.durationMs, 12000);

  const sticker = extractWhatsAppMediaDescriptor({
    stickerMessage: {
      mimetype: "image/webp",
      fileLength: 1024,
      isAnimated: true,
    },
  });
  assert.equal(sticker.type, "sticker");
  assert.equal(sticker.isAnimated, true);
});

test("media MIME allowlist separates documents, audio, and stickers", () => {
  assert.equal(isAllowedInboundMime("document", "application/pdf"), true);
  assert.equal(isAllowedInboundMime("audio", "audio/ogg; codecs=opus"), true);
  assert.equal(isAllowedInboundMime("sticker", "image/webp"), true);
  assert.equal(isAllowedInboundMime("sticker", "image/svg+xml"), false);
  assert.equal(isAllowedInboundMime("document", "text/html"), false);
});

test("media filenames cannot preserve traversal or control characters", () => {
  assert.equal(sanitizeMediaFileName("../../secret\u0000.pdf", "file.bin"), "secret.pdf");
  assert.equal(sanitizeMediaFileName("  laporan   akhir.pdf  ", "file.bin"), "laporan akhir.pdf");
});

test("private media storage writes beneath configured root", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wa-media-test-"));
  const previousRoot = process.env.WA_MEDIA_STORAGE_ROOT;
  process.env.WA_MEDIA_STORAGE_ROOT = root;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.WA_MEDIA_STORAGE_ROOT;
    else process.env.WA_MEDIA_STORAGE_ROOT = previousRoot;
    await fs.rm(root, { recursive: true, force: true });
  });

  const stored = await storePrivateMedia({
    workspaceId: "workspace-a",
    fileName: "voice.ogg",
    data: Buffer.from("audio-data"),
  });
  const info = await getPrivateMediaInfo(stored.storageKey);
  assert.equal(info.byteSize, 10);
  assert.equal(info.absolutePath.startsWith(root), true);
  await assert.rejects(() => getPrivateMediaInfo("../outside"), /Invalid media storage key/);
});

test("audio byte range parser supports standard and suffix ranges", () => {
  assert.deepEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange("bytes=100-", 1000), { start: 100, end: 999 });
  assert.deepEqual(parseByteRange("bytes=-50", 1000), { start: 950, end: 999 });
  assert.equal(parseByteRange("bytes=1000-1001", 1000), "invalid");
  assert.equal(parseByteRange("items=0-2", 1000), "invalid");
});

test("dashboard message idempotency keys are constrained", () => {
  assert.equal(isValidIdempotencyKey("reply:12345678"), true);
  assert.equal(isValidIdempotencyKey("short"), false);
  assert.equal(isValidIdempotencyKey("reply key with spaces"), false);
});

test("media storage driver accepts Cloudflare R2 explicitly", () => {
  assert.equal(resolveMediaStorageDriver("r2"), "r2");
  assert.equal(resolveMediaStorageDriver(" S3 "), "s3");
  assert.equal(resolveMediaStorageDriver("unknown"), "local");
  assert.equal(
    buildCloudflareR2Endpoint("account123"),
    "https://account123.r2.cloudflarestorage.com"
  );
  assert.throws(() => buildCloudflareR2Endpoint("bad/account"), /ACCOUNT_ID is invalid/);
});
