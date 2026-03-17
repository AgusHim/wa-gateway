const test = require("node:test");
const assert = require("node:assert/strict");

const { isTrustedMutationOrigin } = require("../src/lib/security/csrf");

test("csrf origin validation accepts same-origin browser requests", () => {
  const result = isTrustedMutationOrigin({
    originHeader: "https://app.example.com",
    hostHeader: "app.example.com",
    forwardedProtoHeader: "https",
  });

  assert.equal(result, true);
});

test("csrf origin validation rejects cross-site origins", () => {
  const result = isTrustedMutationOrigin({
    originHeader: "https://evil.example.com",
    hostHeader: "app.example.com",
    forwardedProtoHeader: "https",
  });

  assert.equal(result, false);
});
