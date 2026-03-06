const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CircuitBreakerOpenError,
  executeWithCircuitBreaker,
} = require("../src/lib/resilience/circuitBreaker");

test("circuit breaker opens after repeated failures", async () => {
  const key = `test-open-${Date.now()}`;

  await assert.rejects(
    executeWithCircuitBreaker(
      key,
      async () => {
        throw new Error("boom-1");
      },
      { failureThreshold: 2, resetTimeoutMs: 1000 }
    )
  );

  await assert.rejects(
    executeWithCircuitBreaker(
      key,
      async () => {
        throw new Error("boom-2");
      },
      { failureThreshold: 2, resetTimeoutMs: 1000 }
    )
  );

  await assert.rejects(
    executeWithCircuitBreaker(
      key,
      async () => "ok",
      { failureThreshold: 2, resetTimeoutMs: 1000 }
    ),
    (error) => error instanceof CircuitBreakerOpenError
  );
});

test("circuit breaker recovers after reset timeout", async () => {
  const key = `test-recover-${Date.now()}`;

  await assert.rejects(
    executeWithCircuitBreaker(
      key,
      async () => {
        throw new Error("boom");
      },
      { failureThreshold: 1, resetTimeoutMs: 20, successThreshold: 1 }
    )
  );

  await new Promise((resolve) => setTimeout(resolve, 30));

  const result = await executeWithCircuitBreaker(
    key,
    async () => "recovered",
    { failureThreshold: 1, resetTimeoutMs: 20, successThreshold: 1 }
  );

  assert.equal(result, "recovered");
});
