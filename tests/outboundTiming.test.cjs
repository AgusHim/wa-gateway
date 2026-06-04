const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getBroadcastJitterRangeMs,
  resolveOutboundJitterDelayMs,
} = require("../src/lib/wa/outboundTiming");

test("broadcast jitter defaults to 2-8 seconds", () => {
  const previousMin = process.env.WA_BROADCAST_JITTER_MIN_MS;
  const previousMax = process.env.WA_BROADCAST_JITTER_MAX_MS;
  const originalRandom = Math.random;

  delete process.env.WA_BROADCAST_JITTER_MIN_MS;
  delete process.env.WA_BROADCAST_JITTER_MAX_MS;
  Math.random = () => 0;

  try {
    assert.deepEqual(getBroadcastJitterRangeMs(), {
      minMs: 2000,
      maxMs: 8000,
    });
    assert.equal(resolveOutboundJitterDelayMs("broadcast"), 2000);
    assert.equal(resolveOutboundJitterDelayMs("chat"), 0);
    assert.equal(resolveOutboundJitterDelayMs("notification"), 0);
  } finally {
    Math.random = originalRandom;
    if (previousMin === undefined) {
      delete process.env.WA_BROADCAST_JITTER_MIN_MS;
    } else {
      process.env.WA_BROADCAST_JITTER_MIN_MS = previousMin;
    }
    if (previousMax === undefined) {
      delete process.env.WA_BROADCAST_JITTER_MAX_MS;
    } else {
      process.env.WA_BROADCAST_JITTER_MAX_MS = previousMax;
    }
  }
});

test("broadcast jitter normalizes env range and uses inclusive random span", () => {
  const previousMin = process.env.WA_BROADCAST_JITTER_MIN_MS;
  const previousMax = process.env.WA_BROADCAST_JITTER_MAX_MS;
  const originalRandom = Math.random;

  process.env.WA_BROADCAST_JITTER_MIN_MS = "5000";
  process.env.WA_BROADCAST_JITTER_MAX_MS = "3000";
  Math.random = () => 0.999999;

  try {
    assert.deepEqual(getBroadcastJitterRangeMs(), {
      minMs: 5000,
      maxMs: 5000,
    });
    assert.equal(resolveOutboundJitterDelayMs("broadcast"), 5000);
  } finally {
    Math.random = originalRandom;
    if (previousMin === undefined) {
      delete process.env.WA_BROADCAST_JITTER_MIN_MS;
    } else {
      process.env.WA_BROADCAST_JITTER_MIN_MS = previousMin;
    }
    if (previousMax === undefined) {
      delete process.env.WA_BROADCAST_JITTER_MAX_MS;
    } else {
      process.env.WA_BROADCAST_JITTER_MAX_MS = previousMax;
    }
  }
});
