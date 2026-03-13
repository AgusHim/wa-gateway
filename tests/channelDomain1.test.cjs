const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseChannelProvider,
  normalizeChannelProvider,
  isWhatsAppProvider,
} = require("../src/lib/channel/provider");
const {
  resolveChannelUserIdentifier,
  resolveChannelUserDisplayName,
} = require("../src/lib/channel/identity");

test("channel provider parser accepts whatsapp and instagram", () => {
  assert.equal(parseChannelProvider("whatsapp"), "whatsapp");
  assert.equal(parseChannelProvider("instagram"), "instagram");
  assert.equal(parseChannelProvider("  INSTAGRAM  "), "instagram");
  assert.equal(parseChannelProvider("telegram"), null);
});

test("channel provider normalizer falls back to whatsapp", () => {
  assert.equal(normalizeChannelProvider("unknown"), "whatsapp");
  assert.equal(normalizeChannelProvider("instagram"), "instagram");
  assert.equal(isWhatsAppProvider("whatsapp"), true);
  assert.equal(isWhatsAppProvider("instagram"), false);
});

test("channel identity resolver handles whatsapp and instagram", () => {
  assert.equal(
    resolveChannelUserIdentifier({
      provider: "whatsapp",
      phoneNumber: "628111",
    }),
    "628111"
  );

  assert.equal(
    resolveChannelUserIdentifier({
      provider: "instagram",
      externalUserId: "17841400001",
    }),
    "ig:17841400001"
  );

  assert.equal(
    resolveChannelUserIdentifier({
      provider: "instagram",
      username: "John_Doe",
    }),
    "ig:u:john_doe"
  );

  assert.equal(
    resolveChannelUserDisplayName({
      provider: "instagram",
      username: "john",
    }),
    "@john"
  );
});

test("instagram identity requires externalUserId or username", () => {
  assert.throws(
    () =>
      resolveChannelUserIdentifier({
        provider: "instagram",
      }),
    /externalUserId or username is required/
  );
});

