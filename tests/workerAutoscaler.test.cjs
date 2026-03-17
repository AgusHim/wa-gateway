const test = require("node:test");
const assert = require("node:assert/strict");

function loadAutoscalerModule() {
  const clientPath = require.resolve("../src/lib/queue/client");
  const loggerPath = require.resolve("../src/lib/observability/logger");
  const workerRuntimePath = require.resolve("../src/lib/observability/workerRuntime");
  const autoscalerPath = require.resolve("../src/lib/queue/autoscaler");

  const originalClient = require.cache[clientPath];
  const originalLogger = require.cache[loggerPath];
  const originalWorkerRuntime = require.cache[workerRuntimePath];
  const originalAutoscaler = require.cache[autoscalerPath];

  delete require.cache[clientPath];
  delete require.cache[loggerPath];
  delete require.cache[workerRuntimePath];
  delete require.cache[autoscalerPath];

  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: { redis: {} },
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
  require.cache[workerRuntimePath] = {
    id: workerRuntimePath,
    filename: workerRuntimePath,
    loaded: true,
    exports: {
      upsertWorkerRuntimeSnapshot() {},
    },
  };

  const autoscaler = require("../src/lib/queue/autoscaler");

  return {
    autoscaler,
    restore() {
      delete require.cache[autoscalerPath];
      delete require.cache[clientPath];
      delete require.cache[loggerPath];
      delete require.cache[workerRuntimePath];

      if (originalAutoscaler) require.cache[autoscalerPath] = originalAutoscaler;
      if (originalClient) require.cache[clientPath] = originalClient;
      if (originalLogger) require.cache[loggerPath] = originalLogger;
      if (originalWorkerRuntime) require.cache[workerRuntimePath] = originalWorkerRuntime;
    },
  };
}

test("resolveWorkerConcurrencyConfig honors prefix-specific autoscale env", () => {
  const previous = {
    OUTBOUND_WORKER_MIN_CONCURRENCY: process.env.OUTBOUND_WORKER_MIN_CONCURRENCY,
    OUTBOUND_WORKER_MAX_CONCURRENCY: process.env.OUTBOUND_WORKER_MAX_CONCURRENCY,
    OUTBOUND_WORKER_CONCURRENCY: process.env.OUTBOUND_WORKER_CONCURRENCY,
    OUTBOUND_WORKER_AUTOSCALE_INTERVAL_MS: process.env.OUTBOUND_WORKER_AUTOSCALE_INTERVAL_MS,
    OUTBOUND_WORKER_AUTOSCALE_TARGET_BACKLOG: process.env.OUTBOUND_WORKER_AUTOSCALE_TARGET_BACKLOG,
    WORKER_AUTOSCALE_INTERVAL_MS: process.env.WORKER_AUTOSCALE_INTERVAL_MS,
    WORKER_AUTOSCALE_TARGET_BACKLOG: process.env.WORKER_AUTOSCALE_TARGET_BACKLOG,
  };

  process.env.OUTBOUND_WORKER_MIN_CONCURRENCY = "2";
  process.env.OUTBOUND_WORKER_MAX_CONCURRENCY = "8";
  process.env.OUTBOUND_WORKER_CONCURRENCY = "4";
  process.env.OUTBOUND_WORKER_AUTOSCALE_INTERVAL_MS = "7000";
  process.env.OUTBOUND_WORKER_AUTOSCALE_TARGET_BACKLOG = "11";
  process.env.WORKER_AUTOSCALE_INTERVAL_MS = "5000";
  process.env.WORKER_AUTOSCALE_TARGET_BACKLOG = "20";

  const { autoscaler, restore } = loadAutoscalerModule();

  try {
    const config = autoscaler.resolveWorkerConcurrencyConfig({
      envPrefix: "OUTBOUND_WORKER",
      defaultInitial: 1,
      defaultMaxCap: 16,
      defaultTargetBacklog: 10,
    });

    assert.deepEqual(config, {
      min: 2,
      max: 8,
      initial: 4,
      intervalMs: 7000,
      targetBacklog: 11,
    });
  } finally {
    restore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
