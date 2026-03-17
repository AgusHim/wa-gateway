const test = require("node:test");
const assert = require("node:assert/strict");

function loadInstagramClient(overrides = {}) {
  const circuitBreakerPath = require.resolve("../src/lib/resilience/circuitBreaker");
  const loggerPath = require.resolve("../src/lib/observability/logger");
  const configPath = require.resolve("../src/lib/integrations/instagram/config");
  const repoPath = require.resolve("../src/lib/integrations/instagram/repo");
  const clientPath = require.resolve("../src/lib/integrations/instagram/client");

  const originals = {
    circuitBreaker: require.cache[circuitBreakerPath],
    logger: require.cache[loggerPath],
    config: require.cache[configPath],
    repo: require.cache[repoPath],
    client: require.cache[clientPath],
  };

  delete require.cache[circuitBreakerPath];
  delete require.cache[loggerPath];
  delete require.cache[configPath];
  delete require.cache[repoPath];
  delete require.cache[clientPath];

  require.cache[circuitBreakerPath] = {
    id: circuitBreakerPath,
    filename: circuitBreakerPath,
    loaded: true,
    exports: {
      CircuitBreakerOpenError: class CircuitBreakerOpenError extends Error {},
      async executeWithCircuitBreaker(_key, operation) {
        return operation();
      },
    },
  };
  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: {
      logInfo() {},
      logWarn() {},
    },
  };
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      getInstagramIntegrationConfig() {
        return {
          appId: "app-id",
          appSecret: "app-secret",
          graphApiVersion: "v23.0",
          oauthScopes: [],
        };
      },
    },
  };
  require.cache[repoPath] = {
    id: repoPath,
    filename: repoPath,
    loaded: true,
    exports: {
      instagramRepo: {
        async getChannelCredential() {
          return overrides.credential || {
            accessToken: "token-123",
            metadata: {
              instagramAccountId: "17841400000000000",
            },
          };
        },
      },
    },
  };

  const client = require("../src/lib/integrations/instagram/client");

  return {
    client,
    restore() {
      delete require.cache[circuitBreakerPath];
      delete require.cache[loggerPath];
      delete require.cache[configPath];
      delete require.cache[repoPath];
      delete require.cache[clientPath];

      if (originals.circuitBreaker) require.cache[circuitBreakerPath] = originals.circuitBreaker;
      if (originals.logger) require.cache[loggerPath] = originals.logger;
      if (originals.config) require.cache[configPath] = originals.config;
      if (originals.repo) require.cache[repoPath] = originals.repo;
      if (originals.client) require.cache[clientPath] = originals.client;
    },
  };
}

test("instagram DM contract maps request fields and successful Meta response", async () => {
  const { client, restore } = loadInstagramClient();
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { message_id: "mid.abc123" };
      },
    };
  };

  try {
    const result = await client.sendInstagramDirectMessage({
      workspaceId: "ws-1",
      channelId: "ch-1",
      recipientIgUserId: "1789",
      text: "Halo dari AI",
    });

    assert.equal(result.ok, true);
    assert.equal(result.externalId, "mid.abc123");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://graph.facebook.com/v23.0/17841400000000000/messages");

    const body = new URLSearchParams(requests[0].options.body);
    assert.equal(body.get("access_token"), "token-123");
    assert.equal(body.get("messaging_type"), "RESPONSE");
    assert.deepEqual(JSON.parse(body.get("recipient")), { id: "1789" });
    assert.deepEqual(JSON.parse(body.get("message")), { text: "Halo dari AI" });
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("instagram comment contract maps Meta permission error to permission_error", async () => {
  const { client, restore } = loadInstagramClient();
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: false,
    status: 403,
    async json() {
      return {
        error: {
          message: "Missing permission",
          code: 10,
          type: "OAuthException",
          fbtrace_id: "trace-1",
        },
      };
    },
  });

  try {
    const result = await client.replyInstagramComment({
      workspaceId: "ws-1",
      channelId: "ch-1",
      commentId: "comment-123",
      text: "Terima kasih",
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.classification, "permission_error");
    assert.equal(result.error.reasonCode, "meta_permission_10");
    assert.equal(result.error.retryable, false);
    assert.equal(result.error.traceId, "trace-1");
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});
