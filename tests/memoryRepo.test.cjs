const test = require("node:test");
const assert = require("node:assert/strict");

const { createMemoryRepo } = require("../src/lib/db/memoryRepoFactory");

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
    __store: store,
  };
}

test("memoryRepo upsert/get respects unique workspaceId+userId+key", async () => {
  const db = createFakeMemoryDb();
  const repo = createMemoryRepo(db);
  const workspaceId = "workspace-a";

  await repo.upsertMemory({ workspaceId, userId: "u1", key: "name", value: "Joni" });
  await repo.upsertMemory({ workspaceId, userId: "u1", key: "name", value: "Joni Updated" });

  const all = await repo.getMemoriesByUser("u1", workspaceId);

  assert.equal(all.length, 1);
  assert.equal(all[0].value, "Joni Updated");
  assert.equal(db.__store.length, 1);
});

test("memoryRepo deleteMemory removes row", async () => {
  const db = createFakeMemoryDb();
  const repo = createMemoryRepo(db);
  const workspaceId = "workspace-a";

  const row = await repo.upsertMemory({ workspaceId, userId: "u1", key: "city", value: "Bandung" });
  await repo.deleteMemory(row.id, workspaceId);

  const all = await repo.getMemoriesByUser("u1", workspaceId);
  assert.equal(all.length, 0);
});
