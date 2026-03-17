const test = require("node:test");
const assert = require("node:assert/strict");

const {
  verifyInstagramWebhookSignature,
  normalizeInstagramWebhookPayload,
} = require("../src/lib/integrations/instagram/webhook");

test("verifyInstagramWebhookSignature validates sha256 signature", () => {
  const rawBody = JSON.stringify({ object: "instagram", entry: [] });
  const crypto = require("node:crypto");
  const appSecret = "topsecret";
  const signature = `sha256=${crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex")}`;

  assert.equal(
    verifyInstagramWebhookSignature({
      appSecret,
      rawBody,
      signatureHeader: signature,
    }),
    true
  );

  assert.equal(
    verifyInstagramWebhookSignature({
      appSecret,
      rawBody,
      signatureHeader: "sha256=invalid",
    }),
    false
  );
});

test("normalizeInstagramWebhookPayload normalizes DM and comment events", () => {
  const payload = {
    object: "instagram",
    entry: [
      {
        id: "1789",
        messaging: [
          {
            sender: { id: "ig-user-1" },
            recipient: { id: "ig-business-1" },
            timestamp: 1710000000000,
            message: {
              mid: "m_mid_1",
              text: "halo dm",
            },
          },
        ],
        changes: [
          {
            field: "comments",
            value: {
              id: "c_1",
              text: "nice post",
              from: {
                id: "ig-user-2",
                username: "joni",
              },
              media: {
                id: "media_1",
              },
              timestamp: 1710000001,
            },
          },
        ],
      },
    ],
  };

  const events = normalizeInstagramWebhookPayload(payload);
  assert.equal(events.length, 2);

  const dm = events.find((item) => item.eventType === "instagram-dm");
  assert.ok(dm);
  assert.equal(dm.pageId, "1789");
  assert.equal(dm.igUserId, "ig-user-1");
  assert.equal(dm.messageId, "m_mid_1");
  assert.equal(dm.messageText, "halo dm");

  const comment = events.find((item) => item.eventType === "instagram-comment");
  assert.ok(comment);
  assert.equal(comment.commentId, "c_1");
  assert.equal(comment.mediaId, "media_1");
  assert.equal(comment.igUserId, "ig-user-2");
  assert.equal(comment.igUsername, "joni");
});
