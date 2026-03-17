const test = require("node:test");
const assert = require("node:assert/strict");

const previousSecret = process.env.NEXTAUTH_SECRET;
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-nextauth-secret";

const {
  decryptStoredSessionData,
  encryptStoredSessionData,
} = require("../src/lib/security/sessionCipher");

test("session cipher encrypts and decrypts stored session payload", () => {
  const raw = JSON.stringify({ connected: true, key: "value" });
  const encrypted = encryptStoredSessionData(raw);

  assert.notEqual(encrypted, raw);
  assert.equal(decryptStoredSessionData(encrypted), raw);
});

test("session cipher keeps legacy plaintext rows readable", () => {
  const raw = '{"legacy":true}';
  assert.equal(decryptStoredSessionData(raw), raw);
});

process.on("exit", () => {
  if (previousSecret === undefined) {
    delete process.env.NEXTAUTH_SECRET;
  } else {
    process.env.NEXTAUTH_SECRET = previousSecret;
  }
});
