const test = require("node:test");
const assert = require("node:assert/strict");

const { runAgentWithExecutor } = require("../src/agent/runner");

test("runAgentWithExecutor returns executor response", async () => {
  const result = await runAgentWithExecutor(
    async (phone, message) => `echo:${phone}:${message}`,
    "628111",
    "halo"
  );

  assert.equal(result, "echo:628111:halo");
});

test("runAgentWithExecutor returns fallback when executor throws", async () => {
  const originalError = console.error;
  console.error = () => {};

  const result = await runAgentWithExecutor(
    async () => {
      throw new Error("boom");
    },
    "628111",
    "halo"
  );

  console.error = originalError;
  assert.ok(result.includes("sistem sedang mengalami kendala"));
});
