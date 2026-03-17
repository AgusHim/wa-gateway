const test = require("node:test");
const assert = require("node:assert/strict");

function installRedisMock(rows) {
  const clientPath = require.resolve("../src/lib/queue/client");
  const metricsPath = require.resolve("../src/lib/observability/metrics");
  const originalClient = require.cache[clientPath];
  const originalMetrics = require.cache[metricsPath];

  delete require.cache[clientPath];
  delete require.cache[metricsPath];

  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: {
      redis: {
        multi() {
          return {
            hgetall() {
              return this;
            },
            async exec() {
              return rows.map((row) => [null, row]);
            },
          };
        },
      },
    },
  };

  const metrics = require("../src/lib/observability/metrics");

  return {
    metrics,
    restore() {
      delete require.cache[metricsPath];
      delete require.cache[clientPath];

      if (originalMetrics) {
        require.cache[metricsPath] = originalMetrics;
      }

      if (originalClient) {
        require.cache[clientPath] = originalClient;
      }
    },
  };
}

test("metrics snapshot scopes values and queue breakdown to the workspace", async () => {
  const row = {
    queue_lag_ms_sum: "150",
    queue_lag_samples: "2",
    worker_processed: "5",
    worker_failed: "2",
    ai_latency_ms_sum: "600",
    ai_latency_samples: "6",
    delivery_success: "4",
    delivery_failed: "2",
    "workspace:ws-1:queue_lag_ms_sum": "40",
    "workspace:ws-1:queue_lag_samples": "1",
    "workspace:ws-1:worker_processed": "2",
    "workspace:ws-1:worker_failed": "1",
    "workspace:ws-1:ai_latency_ms_sum": "120",
    "workspace:ws-1:ai_latency_samples": "2",
    "workspace:ws-1:delivery_success": "1",
    "workspace:ws-1:delivery_failed": "1",
    "workspace:ws-1:instagram_webhook_ingest_total": "6",
    "workspace:ws-1:instagram_webhook_ingest_accepted": "4",
    "workspace:ws-1:instagram_webhook_ingest_duplicate": "1",
    "workspace:ws-1:instagram_webhook_ingest_skipped": "1",
    "workspace:ws-1:provider:instagram:ai_latency_ms_sum": "70",
    "workspace:ws-1:provider:instagram:ai_latency_samples": "1",
    "workspace:ws-1:provider:instagram:delivery_success": "2",
    "workspace:ws-1:provider:instagram:delivery_failed": "1",
    "queue:whatsapp-inbound--ws-1--ch-1:processed": "2",
    "queue:whatsapp-inbound--ws-1--ch-1:failed": "1",
    "queue:whatsapp-inbound--ws-1--ch-1:lag_sum": "40",
    "queue:whatsapp-inbound--ws-1--ch-1:lag_count": "1",
    "queue:whatsapp-inbound--ws-2--ch-9:processed": "3",
    "queue:whatsapp-inbound--ws-2--ch-9:failed": "1",
    "queue:whatsapp-inbound--ws-2--ch-9:lag_sum": "110",
    "queue:whatsapp-inbound--ws-2--ch-9:lag_count": "1",
  };

  const { metrics, restore } = installRedisMock([row]);

  try {
    const snapshot = await metrics.getMetricsSnapshot(1, { workspaceId: "ws-1" });

    assert.equal(snapshot.queueLagAvgMs, 40);
    assert.equal(snapshot.workerThroughputPerMinute, 2);
    assert.equal(snapshot.aiLatencyAvgMs, 60);
    assert.equal(snapshot.deliverySuccessRate, 50);
    assert.equal(snapshot.instagram.webhookIngestPerMinute, 6);
    assert.equal(snapshot.instagram.webhookAccepted, 4);
    assert.equal(snapshot.instagram.aiLatencyAvgMs, 70);
    assert.equal(snapshot.instagram.outboundSuccessRate, 66.67);
    assert.deepEqual(snapshot.queueBreakdown, [
      {
        queueName: "whatsapp-inbound--ws-1--ch-1",
        processed: 2,
        failed: 1,
        lagAvgMs: 40,
      },
    ]);
  } finally {
    restore();
  }
});
