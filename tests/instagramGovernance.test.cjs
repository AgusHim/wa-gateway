const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getInstagramIntegrationConfig,
  DEFAULT_INSTAGRAM_OAUTH_SCOPES,
} = require("../src/lib/integrations/instagram/config");
const {
  isInstagramScopedUserIdentifier,
  resolveInstagramRetentionPolicy,
} = require("../src/lib/integrations/instagram/privacyPolicy");
const {
  defaultInstagramAutoReplyRules,
  normalizeInstagramAutoReplyRules,
  evaluateInstagramAutoReplyRule,
} = require("../src/lib/integrations/instagram/ruleConfig");
const { maybeRedactPii } = require("../src/lib/security/pii");

const previousEnv = {
  INSTAGRAM_APP_ID: process.env.INSTAGRAM_APP_ID,
  INSTAGRAM_APP_SECRET: process.env.INSTAGRAM_APP_SECRET,
  INSTAGRAM_OAUTH_SCOPES: process.env.INSTAGRAM_OAUTH_SCOPES,
  INSTAGRAM_DM_RETENTION_DAYS: process.env.INSTAGRAM_DM_RETENTION_DAYS,
  INSTAGRAM_COMMENT_RETENTION_DAYS: process.env.INSTAGRAM_COMMENT_RETENTION_DAYS,
  INSTAGRAM_MEDIA_METADATA_RETENTION_DAYS: process.env.INSTAGRAM_MEDIA_METADATA_RETENTION_DAYS,
};

test("instagram config defaults to minimum required scopes", () => {
  process.env.INSTAGRAM_APP_ID = "app-id";
  process.env.INSTAGRAM_APP_SECRET = "app-secret";
  delete process.env.INSTAGRAM_OAUTH_SCOPES;

  const config = getInstagramIntegrationConfig();
  assert.ok(config);
  assert.deepEqual(config.oauthScopes, [...DEFAULT_INSTAGRAM_OAUTH_SCOPES]);
});

test("instagram retention policy uses defaults and clamps invalid values", () => {
  delete process.env.INSTAGRAM_DM_RETENTION_DAYS;
  process.env.INSTAGRAM_COMMENT_RETENTION_DAYS = "99999";
  process.env.INSTAGRAM_MEDIA_METADATA_RETENTION_DAYS = "0";

  const policy = resolveInstagramRetentionPolicy();
  assert.equal(policy.dmRetentionDays, 365);
  assert.equal(policy.commentRetentionDays, 3650);
  assert.equal(policy.mediaMetadataRetentionDays, 1);
});

test("instagram scoped identifier check only accepts ig-prefixed identities", () => {
  assert.equal(isInstagramScopedUserIdentifier("ig:12345"), true);
  assert.equal(isInstagramScopedUserIdentifier("IG:username"), true);
  assert.equal(isInstagramScopedUserIdentifier("+62812"), false);
});

test("PII redaction can follow workspace policy toggle", () => {
  const payload = {
    customer: "Budi",
    email: "budi@example.com",
    phone: "+62 812-0000-1111",
  };

  assert.deepEqual(maybeRedactPii(payload, true), {
    customer: "Budi",
    email: "[REDACTED_EMAIL]",
    phone: "[REDACTED_PHONE]",
  });
  assert.deepEqual(maybeRedactPii(payload, false), payload);
});

test("instagram DM auto-reply rules support keyword filtering", () => {
  const rules = normalizeInstagramAutoReplyRules({
    ...defaultInstagramAutoReplyRules(),
    dm: {
      enabled: true,
      keywordMode: "keywords",
      keywords: ["harga", "promo"],
      businessHoursOnly: false,
      fallbackMessage: "",
      escalationPolicy: "none",
    },
  });

  const blocked = evaluateInstagramAutoReplyRule({
    eventType: "instagram-dm",
    messageText: "Halo kak, mau tanya dong",
    rules,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "dm_keyword_not_match");

  const allowed = evaluateInstagramAutoReplyRule({
    eventType: "instagram-dm",
    messageText: "Halo kak, promo hari ini apa?",
    rules,
  });
  assert.equal(allowed.allowed, true);
  assert.deepEqual(allowed.matchedKeywords, ["promo"]);
});

process.on("exit", () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});
