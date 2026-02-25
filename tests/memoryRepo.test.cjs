const test = require("node:test");
const assert = require("node:assert/strict");

const { createMemoryRepo } = require("../src/lib/db/memoryRepoFactory");

function createFakeMemoryDb() {
  const store = [];

  return {
    memory: {
      async upsert({ where, update, create }) {
        const idx = store.findIndex(
          (item) => item.userId === where.userId_key.userId && item.key === where.userId_key.key
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
          id: `${create.userId}:${create.key}`,
          userId: create.userId,
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
          .filter((item) => item.userId === where.userId)
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      },
      async delete({ where }) {
        const idx = store.findIndex((item) => item.id === where.id);
        if (idx < 0) throw new Error("Not found");
        const [row] = store.splice(idx, 1);
        return row;
      },
    },
    __store: store,
  };
}

test("memoryRepo upsert/get respects unique userId+key", async () => {
  const db = createFakeMemoryDb();
  const repo = createMemoryRepo(db);

  await repo.upsertMemory({ userId: "u1", key: "name", value: "Joni" });
  await repo.upsertMemory({ userId: "u1", key: "name", value: "Joni Updated" });

  const all = await repo.getMemoriesByUser("u1");

  assert.equal(all.length, 1);
  assert.equal(all[0].value, "Joni Updated");
  assert.equal(db.__store.length, 1);
});

test("memoryRepo deleteMemory removes row", async () => {
  const db = createFakeMemoryDb();
  const repo = createMemoryRepo(db);

  const row = await repo.upsertMemory({ userId: "u1", key: "city", value: "Bandung" });
  await repo.deleteMemory(row.id);

  const all = await repo.getMemoriesByUser("u1");
  assert.equal(all.length, 0);
});
