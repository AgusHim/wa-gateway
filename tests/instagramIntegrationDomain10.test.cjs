const test = require("node:test");
const assert = require("node:assert/strict");

function loadInstagramWorkerModule() {
  const modulePaths = {
    runner: require.resolve("../src/agent/runner"),
    baileys: require.resolve("../src/lib/baileys/client"),
    billing: require.resolve("../src/lib/billing/service"),
    dbClient: require.resolve("../src/lib/db/client"),
    channelRepo: require.resolve("../src/lib/db/channelRepo"),
    configRepo: require.resolve("../src/lib/db/configRepo"),
    handoverRepo: require.resolve("../src/lib/handover/repo"),
    messageRepo: require.resolve("../src/lib/db/messageRepo"),
    userRepo: require.resolve("../src/lib/db/userRepo"),
    webhookService: require.resolve("../src/lib/integrations/webhookService"),
    metrics: require.resolve("../src/lib/observability/metrics"),
    context: require.resolve("../src/lib/observability/context"),
    logger: require.resolve("../src/lib/observability/logger"),
    autoscaler: require.resolve("../src/lib/queue/autoscaler"),
    queueClient: require.resolve("../src/lib/queue/client"),
    inboundDebounce: require.resolve("../src/lib/integrations/instagram/inboundDebounce"),
    client: require.resolve("../src/lib/integrations/instagram/client"),
    compliance: require.resolve("../src/lib/integrations/instagram/compliance"),
    messageMetadata: require.resolve("../src/lib/integrations/instagram/messageMetadata"),
    ruleConfig: require.resolve("../src/lib/integrations/instagram/ruleConfig"),
    webhookQueue: require.resolve("../src/lib/integrations/instagram/webhookQueue"),
    worker: require.resolve("../src/lib/integrations/instagram/webhookWorker"),
  };

  const originals = Object.fromEntries(
    Object.entries(modulePaths).map(([key, value]) => [key, require.cache[value]])
  );

  for (const path of Object.values(modulePaths)) {
    delete require.cache[path];
  }

  require.cache[modulePaths.runner] = {
    id: modulePaths.runner,
    filename: modulePaths.runner,
    loaded: true,
    exports: { runAgent: async () => "stub-response" },
  };
  require.cache[modulePaths.baileys] = {
    id: modulePaths.baileys,
    filename: modulePaths.baileys,
    loaded: true,
    exports: { sendOperatorReport: async () => null },
  };
  require.cache[modulePaths.billing] = {
    id: modulePaths.billing,
    filename: modulePaths.billing,
    loaded: true,
    exports: { billingService: { consumeUsage: async () => ({ allowed: true, softLimitReached: false, used: 1, projected: 1, limit: 100 }) } },
  };
  require.cache[modulePaths.dbClient] = {
    id: modulePaths.dbClient,
    filename: modulePaths.dbClient,
    loaded: true,
    exports: { prisma: { channel: { findFirst: async () => null }, instagramChannelConfig: { updateMany: async () => ({ count: 0 }) } } },
  };
  require.cache[modulePaths.channelRepo] = {
    id: modulePaths.channelRepo,
    filename: modulePaths.channelRepo,
    loaded: true,
    exports: { channelRepo: { createAudit: async () => null } },
  };
  require.cache[modulePaths.configRepo] = {
    id: modulePaths.configRepo,
    filename: modulePaths.configRepo,
    loaded: true,
    exports: {
      configRepo: {
        getBotConfig: async () => ({
          timezone: "Asia/Jakarta",
          businessHoursStart: "09:00",
          businessHoursEnd: "17:00",
          businessDays: [1, 2, 3, 4, 5],
          outOfHoursAutoReplyEnabled: false,
          outOfHoursMessage: "",
        }),
      },
    },
  };
  require.cache[modulePaths.handoverRepo] = {
    id: modulePaths.handoverRepo,
    filename: modulePaths.handoverRepo,
    loaded: true,
    exports: { handoverRepo: { markPending: async () => null } },
  };
  require.cache[modulePaths.messageRepo] = {
    id: modulePaths.messageRepo,
    filename: modulePaths.messageRepo,
    loaded: true,
    exports: {
      messageRepo: {
        attachInstagramOutboundResultByEventId: async () => true,
        saveMessage: async () => null,
        getInstagramThreadAutoReplyState: async () => null,
        hasHumanOperatorReplyInInstagramThreadSince: async () => false,
      },
    },
  };
  require.cache[modulePaths.userRepo] = {
    id: modulePaths.userRepo,
    filename: modulePaths.userRepo,
    loaded: true,
    exports: { userRepo: { upsertUserByChannelIdentity: async () => ({ id: "user-1" }), upsertUser: async () => ({ id: "user-1" }) } },
  };
  require.cache[modulePaths.webhookService] = {
    id: modulePaths.webhookService,
    filename: modulePaths.webhookService,
    loaded: true,
    exports: { webhookService: { enqueueEvent: async () => null } },
  };
  require.cache[modulePaths.metrics] = {
    id: modulePaths.metrics,
    filename: modulePaths.metrics,
    loaded: true,
    exports: {
      recordDeliveryFailureReason: async () => null,
      recordDeliveryResult: async () => null,
      recordQueueLag: async () => null,
      recordWorkerThroughput: async () => null,
    },
  };
  require.cache[modulePaths.context] = {
    id: modulePaths.context,
    filename: modulePaths.context,
    loaded: true,
    exports: { withObservationContext: async (_ctx, fn) => fn() },
  };
  require.cache[modulePaths.logger] = {
    id: modulePaths.logger,
    filename: modulePaths.logger,
    loaded: true,
    exports: { logError() {}, logInfo() {}, logWarn() {} },
  };
  require.cache[modulePaths.autoscaler] = {
    id: modulePaths.autoscaler,
    filename: modulePaths.autoscaler,
    loaded: true,
    exports: {
      resolveWorkerConcurrencyConfig() {
        return { initial: 1, min: 1, max: 1, intervalMs: 1000, targetBacklog: 10 };
      },
      startQueueAutoscaler() {},
    },
  };
  require.cache[modulePaths.queueClient] = {
    id: modulePaths.queueClient,
    filename: modulePaths.queueClient,
    loaded: true,
    exports: { redis: {} },
  };
  require.cache[modulePaths.inboundDebounce] = {
    id: modulePaths.inboundDebounce,
    filename: modulePaths.inboundDebounce,
    loaded: true,
    exports: { consumeInstagramInboundDebouncedBatch: async (job) => ({ data: job.data, batchCount: 1, firstBufferedAt: job.data.receivedAt }) },
  };
  require.cache[modulePaths.client] = {
    id: modulePaths.client,
    filename: modulePaths.client,
    loaded: true,
    exports: {
      InstagramOutboundError: class InstagramOutboundError extends Error {
        constructor(input) {
          super(input.message);
          this.name = "InstagramOutboundError";
          this.reasonCode = input.reasonCode;
          this.retryable = input.retryable;
          this.classification = input.classification;
        }
      },
      replyInstagramComment: async () => ({ ok: true, target: "comment", externalId: "reply-1", statusCode: 200, raw: {} }),
      sendInstagramDirectMessage: async () => ({ ok: true, target: "dm", externalId: "dm-1", statusCode: 200, raw: {} }),
    },
  };
  require.cache[modulePaths.compliance] = {
    id: modulePaths.compliance,
    filename: modulePaths.compliance,
    loaded: true,
    exports: {
      evaluateInstagramOutboundPolicy: () => ({ ok: true, violations: [] }),
      consumeInstagramOutboundRateLimit: async () => ({ ok: true, tenantCount: 1, tenantLimit: 10, channelCount: 1, channelLimit: 5 }),
    },
  };
  require.cache[modulePaths.messageMetadata] = {
    id: modulePaths.messageMetadata,
    filename: modulePaths.messageMetadata,
    loaded: true,
    exports: {
      buildInstagramMessageMetadata(input) {
        return { source: "instagram", eventType: input.eventType, channelId: input.channelId, threadId: input.threadId, commentId: input.commentId, igUserId: input.igUserId };
      },
    },
  };
  require.cache[modulePaths.ruleConfig] = {
    id: modulePaths.ruleConfig,
    filename: modulePaths.ruleConfig,
    loaded: true,
    exports: {
      getWorkspaceInstagramAutoReplyRules: async () => ({
        comment: { enabled: true, keywordMode: "all", keywords: [], sentimentThreshold: -1 },
        dm: {
          enabled: true,
          keywordMode: "all",
          keywords: [],
          businessHoursOnly: false,
          fallbackMessage: "",
          escalationPolicy: "none",
        },
      }),
      evaluateInstagramAutoReplyRule: () => ({
        allowed: true,
        reason: "dm_allowed",
        matchedKeywords: [],
        sentimentScore: 0,
      }),
    },
  };
  require.cache[modulePaths.webhookQueue] = {
    id: modulePaths.webhookQueue,
    filename: modulePaths.webhookQueue,
    loaded: true,
    exports: {
      getInstagramWebhookDeadLetterQueue: () => ({ add: async () => null }),
      getInstagramWebhookQueueName: () => "ig-queue",
    },
  };

  const workerModule = require("../src/lib/integrations/instagram/webhookWorker");

  return {
    workerModule,
    restore() {
      for (const [key, path] of Object.entries(modulePaths)) {
        delete require.cache[path];
        if (originals[key]) require.cache[path] = originals[key];
      }
    },
  };
}

function buildBaseJob(overrides = {}) {
  return {
    id: "job-1",
    queueName: "instagram-webhook-inbound--ws-1--ch-1",
    attemptsMade: 0,
    data: {
      workspaceId: "ws-1",
      channelId: "ch-1",
      eventId: "evt-1",
      eventKey: "dm:evt-1",
      eventType: "instagram-dm",
      occurredAt: Date.now() - 1000,
      receivedAt: Date.now(),
      igUserId: "1789",
      igUsername: "alice",
      threadId: "1789",
      messageText: "Halo bot",
      rawEvent: {},
      ...overrides,
    },
  };
}

test("instagram worker integration processes DM and comment jobs with outbound mock", async () => {
  const { workerModule, restore } = loadInstagramWorkerModule();
  const calls = {
    audits: [],
    outbound: [],
    agent: [],
    webhook: [],
  };

  const processor = workerModule.createInstagramWebhookJobProcessor({
    consumeInstagramInboundDebouncedBatch: async (job) => ({ data: job.data, batchCount: 1, firstBufferedAt: job.data.receivedAt }),
    recordQueueLag: async () => null,
    logInfo: () => {},
    prisma: {
      channel: { findFirst: async () => ({ id: "ch-1", workspaceId: "ws-1", isEnabled: true, status: "active", rateLimitPerSecond: 5 }) },
      instagramChannelConfig: { updateMany: async () => ({ count: 1 }) },
    },
    billingService: {
      async consumeUsage(input) {
        return { allowed: true, softLimitReached: false, used: 1, projected: 1, limit: input.metric === "IG_INBOUND" ? 100 : 50 };
      },
    },
    messageRepo: {},
    channelRepo: {},
    handoverRepo: {},
    runAgent: async (...args) => {
      calls.agent.push(args);
      return args[5].source === "instagram-comment" ? "Balas komentar" : "Balas DM";
    },
    consumeInstagramOutboundRateLimit: async () => ({ ok: true, tenantCount: 1, tenantLimit: 10, channelCount: 1, channelLimit: 5 }),
    replyInstagramComment: async (input) => {
      calls.outbound.push({ target: "comment", input });
      return { ok: true, target: "comment", externalId: "reply-123", statusCode: 200, raw: {} };
    },
    sendInstagramDirectMessage: async (input) => {
      calls.outbound.push({ target: "dm", input });
      return { ok: true, target: "dm", externalId: "dm-123", statusCode: 200, raw: {} };
    },
    recordDeliveryResult: async () => null,
    recordDeliveryFailureReason: async () => null,
    webhookService: {
      async enqueueEvent(payload) {
        calls.webhook.push(payload);
      },
    },
    sendOperatorReport: async () => null,
    userRepo: {
      async upsertUserByChannelIdentity() {
        return { id: "user-1" };
      },
      async upsertUser() {
        return { id: "user-1" };
      },
    },
    logWarn: () => {},
    createAudit: async (channelId, payload) => {
      calls.audits.push({ channelId, payload });
    },
    attachInstagramOutboundResultByEventId: async () => true,
    saveMessage: async () => null,
    getInstagramThreadAutoReplyState: async () => null,
    hasHumanOperatorReplyInInstagramThreadSince: async () => false,
    markPending: async () => null,
  });

  try {
    await processor(buildBaseJob());
    await processor(buildBaseJob({
      eventId: "evt-2",
      eventKey: "comment:evt-2",
      eventType: "instagram-comment",
      commentId: "comment-9",
      mediaId: "media-1",
      threadId: "media-1",
      messageText: "Komentar masuk",
    }));

    assert.equal(calls.agent.length, 2);
    assert.equal(calls.outbound.length, 2);
    assert.deepEqual(calls.outbound.map((item) => item.target), ["dm", "comment"]);
    assert.equal(calls.webhook.length, 2);
    assert.ok(calls.audits.some((entry) => entry.payload.eventType === "instagram_agent_response_generated"));
    assert.ok(calls.audits.some((entry) => entry.payload.eventType === "instagram_outbound_sent"));
  } finally {
    restore();
  }
});

test("instagram worker burst smoke handles multiple inbound jobs without duplicate outbound count", async () => {
  const { workerModule, restore } = loadInstagramWorkerModule();
  let outboundCount = 0;

  const processor = workerModule.createInstagramWebhookJobProcessor({
    consumeInstagramInboundDebouncedBatch: async (job) => ({ data: job.data, batchCount: 1, firstBufferedAt: job.data.receivedAt }),
    recordQueueLag: async () => null,
    logInfo: () => {},
    prisma: {
      channel: { findFirst: async () => ({ id: "ch-1", workspaceId: "ws-1", isEnabled: true, status: "active", rateLimitPerSecond: 10 }) },
      instagramChannelConfig: { updateMany: async () => ({ count: 1 }) },
    },
    billingService: { async consumeUsage() { return { allowed: true, softLimitReached: false, used: 1, projected: 1, limit: 1000 }; } },
    messageRepo: {},
    channelRepo: {},
    handoverRepo: {},
    runAgent: async () => "Burst OK",
    consumeInstagramOutboundRateLimit: async () => ({ ok: true, tenantCount: 1, tenantLimit: 100, channelCount: 1, channelLimit: 20 }),
    replyInstagramComment: async () => ({ ok: true, target: "comment", externalId: "reply", statusCode: 200, raw: {} }),
    sendInstagramDirectMessage: async () => {
      outboundCount += 1;
      return { ok: true, target: "dm", externalId: `dm-${outboundCount}`, statusCode: 200, raw: {} };
    },
    recordDeliveryResult: async () => null,
    recordDeliveryFailureReason: async () => null,
    webhookService: { async enqueueEvent() {} },
    sendOperatorReport: async () => null,
    userRepo: {
      async upsertUserByChannelIdentity() { return { id: "user-1" }; },
      async upsertUser() { return { id: "user-1" }; },
    },
    logWarn: () => {},
    createAudit: async () => null,
    attachInstagramOutboundResultByEventId: async () => true,
    saveMessage: async () => null,
    getInstagramThreadAutoReplyState: async () => null,
    hasHumanOperatorReplyInInstagramThreadSince: async () => false,
    markPending: async () => null,
  });

  try {
    const jobs = Array.from({ length: 25 }, (_, index) => buildBaseJob({
      eventId: `evt-${index + 1}`,
      eventKey: `dm:evt-${index + 1}`,
      threadId: `thread-${index + 1}`,
      igUserId: `ig-${index + 1}`,
      igUsername: `user${index + 1}`,
      messageText: `msg-${index + 1}`,
    }));

    await Promise.all(jobs.map((job) => processor(job)));
    assert.equal(outboundCount, 25);
  } finally {
    restore();
  }
});

test("instagram worker skips outbound when development mode fallback is active", async () => {
  const { workerModule, restore } = loadInstagramWorkerModule();
  const previousEnv = {
    INSTAGRAM_APP_MODE: process.env.INSTAGRAM_APP_MODE,
    INSTAGRAM_DEV_MODE_ALLOWED_WORKSPACES: process.env.INSTAGRAM_DEV_MODE_ALLOWED_WORKSPACES,
  };
  process.env.INSTAGRAM_APP_MODE = "development";
  process.env.INSTAGRAM_DEV_MODE_ALLOWED_WORKSPACES = "ws-pilot";

  const calls = {
    outbound: 0,
    savedMessages: [],
    audits: [],
  };

  const processor = workerModule.createInstagramWebhookJobProcessor({
    consumeInstagramInboundDebouncedBatch: async (job) => ({ data: job.data, batchCount: 1, firstBufferedAt: job.data.receivedAt }),
    recordQueueLag: async () => null,
    logInfo: () => {},
    prisma: {
      channel: { findFirst: async () => ({ id: "ch-1", workspaceId: "ws-prod", isEnabled: true, status: "active", rateLimitPerSecond: 5 }) },
      instagramChannelConfig: { updateMany: async () => ({ count: 1 }) },
    },
    billingService: { async consumeUsage() { return { allowed: true, softLimitReached: false, used: 1, projected: 1, limit: 1000 }; } },
    messageRepo: {},
    channelRepo: {},
    handoverRepo: {},
    runAgent: async () => "should-not-run",
    consumeInstagramOutboundRateLimit: async () => ({ ok: true, tenantCount: 1, tenantLimit: 100, channelCount: 1, channelLimit: 20 }),
    replyInstagramComment: async () => {
      calls.outbound += 1;
      return { ok: true, target: "comment", externalId: "reply", statusCode: 200, raw: {} };
    },
    sendInstagramDirectMessage: async () => {
      calls.outbound += 1;
      return { ok: true, target: "dm", externalId: "dm", statusCode: 200, raw: {} };
    },
    recordDeliveryResult: async () => null,
    recordDeliveryFailureReason: async () => null,
    webhookService: { async enqueueEvent() {} },
    sendOperatorReport: async () => null,
    userRepo: {
      async upsertUserByChannelIdentity() { return { id: "user-1" }; },
      async upsertUser() { return { id: "user-1" }; },
    },
    logWarn: () => {},
    createAudit: async (_channelId, payload) => {
      calls.audits.push(payload);
    },
    attachInstagramOutboundResultByEventId: async () => true,
    saveMessage: async (payload) => {
      calls.savedMessages.push(payload);
    },
    getInstagramThreadAutoReplyState: async () => null,
    hasHumanOperatorReplyInInstagramThreadSince: async () => false,
    markPending: async () => null,
  });

  try {
    await processor(buildBaseJob({
      workspaceId: "ws-prod",
      channelId: "ch-1",
    }));

    assert.equal(calls.outbound, 0);
    assert.equal(calls.savedMessages.length, 1);
    assert.equal(calls.savedMessages[0].metadata.autoReplySkippedReason, "meta-development-mode-fallback");
    assert.ok(calls.audits.some((entry) => entry.eventType === "instagram_webhook_skipped_development_mode"));
  } finally {
    restore();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("instagram worker skips DM auto-reply when keyword rule does not match", async () => {
  const { workerModule, restore } = loadInstagramWorkerModule();
  const calls = {
    outbound: 0,
    agent: 0,
    savedMessages: [],
    audits: [],
  };

  const processor = workerModule.createInstagramWebhookJobProcessor({
    consumeInstagramInboundDebouncedBatch: async (job) => ({ data: job.data, batchCount: 1, firstBufferedAt: job.data.receivedAt }),
    recordQueueLag: async () => null,
    logInfo: () => {},
    prisma: {
      channel: { findFirst: async () => ({ id: "ch-1", workspaceId: "ws-1", isEnabled: true, status: "active", rateLimitPerSecond: 5 }) },
      instagramChannelConfig: { updateMany: async () => ({ count: 1 }) },
    },
    billingService: { async consumeUsage() { return { allowed: true, softLimitReached: false, used: 1, projected: 1, limit: 1000 }; } },
    runAgent: async () => {
      calls.agent += 1;
      return "should-not-run";
    },
    consumeInstagramOutboundRateLimit: async () => ({ ok: true, tenantCount: 1, tenantLimit: 100, channelCount: 1, channelLimit: 20 }),
    replyInstagramComment: async () => {
      calls.outbound += 1;
      return { ok: true, target: "comment", externalId: "reply", statusCode: 200, raw: {} };
    },
    sendInstagramDirectMessage: async () => {
      calls.outbound += 1;
      return { ok: true, target: "dm", externalId: "dm", statusCode: 200, raw: {} };
    },
    recordDeliveryResult: async () => null,
    recordDeliveryFailureReason: async () => null,
    webhookService: { async enqueueEvent() {} },
    sendOperatorReport: async () => null,
    userRepo: {
      async upsertUserByChannelIdentity() { return { id: "user-1" }; },
      async upsertUser() { return { id: "user-1" }; },
    },
    logWarn: () => {},
    getWorkspaceInstagramAutoReplyRules: async () => ({
      comment: { enabled: true, keywordMode: "all", keywords: [], sentimentThreshold: -1 },
      dm: {
        enabled: true,
        keywordMode: "keywords",
        keywords: ["harga", "promo"],
        businessHoursOnly: false,
        fallbackMessage: "",
        escalationPolicy: "none",
      },
    }),
    evaluateInstagramAutoReplyRule: () => ({
      allowed: false,
      reason: "dm_keyword_not_match",
      matchedKeywords: [],
      sentimentScore: 0,
    }),
    getBotConfig: async () => ({
      timezone: "Asia/Jakarta",
      businessHoursStart: "09:00",
      businessHoursEnd: "17:00",
      businessDays: [1, 2, 3, 4, 5],
      outOfHoursAutoReplyEnabled: false,
      outOfHoursMessage: "",
    }),
    createAudit: async (_channelId, payload) => {
      calls.audits.push(payload);
    },
    attachInstagramOutboundResultByEventId: async () => true,
    saveMessage: async (payload) => {
      calls.savedMessages.push(payload);
    },
    getInstagramThreadAutoReplyState: async () => null,
    hasHumanOperatorReplyInInstagramThreadSince: async () => false,
    markPending: async () => null,
  });

  try {
    await processor(buildBaseJob({
      messageText: "Halo kak, saya cuma mau sapa",
    }));

    assert.equal(calls.agent, 0);
    assert.equal(calls.outbound, 0);
    assert.equal(calls.savedMessages.length, 1);
    assert.equal(calls.savedMessages[0].metadata.autoReplySkippedReason, "dm_keyword_not_match");
    assert.ok(calls.audits.some((entry) => entry.eventType === "instagram_webhook_skipped_auto_reply_rule"));
  } finally {
    restore();
  }
});
