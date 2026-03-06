const test = require("node:test");
const assert = require("node:assert/strict");

const { RuntimeCache } = require("../src/lib/cache/runtimeCache");

test("runtime cache getOrLoad caches values until TTL", async () => {
  const cache = new RuntimeCache(20);
  let loadCount = 0;

  const loader = async () => {
    loadCount += 1;
    return { value: loadCount };
  };

  const first = await cache.getOrLoad("a", loader);
  const second = await cache.getOrLoad("a", loader);

  assert.equal(first.value, 1);
  assert.equal(second.value, 1);
  assert.equal(loadCount, 1);

  await new Promise((resolve) => setTimeout(resolve, 25));
  const third = await cache.getOrLoad("a", loader);

  assert.equal(third.value, 2);
  assert.equal(loadCount, 2);
});
