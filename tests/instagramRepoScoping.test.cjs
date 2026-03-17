const test = require("node:test");
const assert = require("node:assert/strict");

function loadMessageRepoWithStub(stubPrisma) {
  const clientPath = require.resolve("../src/lib/db/client");
  const repoPath = require.resolve("../src/lib/db/messageRepo");

  const originalClient = require.cache[clientPath];
  const originalRepo = require.cache[repoPath];

  delete require.cache[clientPath];
  delete require.cache[repoPath];

  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: { prisma: stubPrisma },
  };

  const repo = require("../src/lib/db/messageRepo");

  return {
    repo,
    restore() {
      delete require.cache[repoPath];
      delete require.cache[clientPath];

      if (originalRepo) require.cache[repoPath] = originalRepo;
      if (originalClient) require.cache[clientPath] = originalClient;
    },
  };
}

test("instagram conversation repo scopes thread query by workspace and channel", async () => {
  const calls = [];
  const { repo, restore } = loadMessageRepoWithStub({
    message: {
      async findMany(args) {
        calls.push(args);
        return [];
      },
    },
  });

  try {
    await repo.messageRepo.getConversationByInstagramThread("ws-1", "thread-123", 1, 25, "ig-ch-1");

    assert.equal(calls.length, 1);
    const query = calls[0];
    assert.equal(query.where.workspaceId, "ws-1");
    assert.deepEqual(query.where.AND, [
      { metadata: { path: ["source"], equals: "instagram" } },
      { metadata: { path: ["threadId"], equals: "thread-123" } },
      { metadata: { path: ["channelId"], equals: "ig-ch-1" } },
    ]);
    assert.equal(query.take, 25);
  } finally {
    restore();
  }
});

test("instagram conversation repo scopes user query by workspace", async () => {
  const calls = [];
  const { repo, restore } = loadMessageRepoWithStub({
    message: {
      async findMany(args) {
        calls.push(args);
        return [];
      },
    },
  });

  try {
    await repo.messageRepo.getConversationByInstagramUserId("ws-2", "1789", 1, 10);

    assert.equal(calls.length, 1);
    const query = calls[0];
    assert.equal(query.where.workspaceId, "ws-2");
    assert.deepEqual(query.where.AND, [
      { metadata: { path: ["source"], equals: "instagram" } },
      { metadata: { path: ["igUserId"], equals: "1789" } },
    ]);
  } finally {
    restore();
  }
});
