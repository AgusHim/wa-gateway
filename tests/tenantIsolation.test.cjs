const test = require("node:test");
const assert = require("node:assert/strict");

const { createMemoryRepo } = require("../src/lib/db/memoryRepoFactory");
const { assertTenantScope } = require("../src/lib/tenant/context");

function createFakeMemoryDb() {
  const store = [];

  return {
    memory: {
      async upsert({ where, update, create }) {
        const idx = store.findIndex(
          (item) =>
            item.workspaceId === where.workspaceId_userId_channelId_key.workspaceId &&
            item.userId === where.workspaceId_userId_channelId_key.userId &&
            item.channelId === where.workspaceId_userId_channelId_key.channelId &&
            item.key === where.workspaceId_userId_channelId_key.key
        );

        if (idx >= 0) {
          store[idx] = {
            ...store[idx],
            ...update,
            updatedAt: new Date(),
          };
          return store[idx];
        }

        const row = {
          id: `${create.workspaceId}:${create.userId}:${create.key}`,
          workspaceId: create.workspaceId,
          userId: create.userId,
          channelId: create.channelId,
          key: create.key,
          value: create.value,
          source: create.source,
          confidence: create.confidence,
          updatedAt: new Date(),
        };
        store.push(row);
        return row;
      },
      async findMany({ where }) {
        return store
          .filter((item) => item.workspaceId === where.workspaceId && item.userId === where.userId)
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      },
      async deleteMany({ where }) {
        const idx = store.findIndex(
          (item) => item.id === where.id && item.workspaceId === where.workspaceId
        );
        if (idx < 0) return { count: 0 };
        store.splice(idx, 1);
        return { count: 1 };
      },
    },
  };
}

test("memoryRepo isolates records across workspaces", async () => {
  const repo = createMemoryRepo(createFakeMemoryDb());

  await repo.upsertMemory({
    workspaceId: "workspace-a",
    userId: "u1",
    key: "city",
    value: "Bandung",
  });
  await repo.upsertMemory({
    workspaceId: "workspace-b",
    userId: "u1",
    key: "city",
    value: "Jakarta",
  });

  const workspaceAMemories = await repo.getMemoriesByUser("u1", "workspace-a");
  const workspaceBMemories = await repo.getMemoriesByUser("u1", "workspace-b");

  assert.equal(workspaceAMemories.length, 1);
  assert.equal(workspaceBMemories.length, 1);
  assert.equal(workspaceAMemories[0].value, "Bandung");
  assert.equal(workspaceBMemories[0].value, "Jakarta");
});

test("assertTenantScope rejects empty workspace scope", () => {
  assert.throws(() => assertTenantScope(""), /workspaceId is required/);
  assert.equal(assertTenantScope("workspace-a"), "workspace-a");
});
