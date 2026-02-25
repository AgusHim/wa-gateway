const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSystemPrompt } = require("../src/agent/prompts/systemPrompt");
const { buildMemoryPrompt } = require("../src/agent/prompts/memoryPrompt");
const { buildHistoryMessages } = require("../src/agent/prompts/historyPrompt");

test("buildSystemPrompt includes identity behavior and skills", () => {
  const result = buildSystemPrompt();

  assert.ok(result.includes("PENTING: Kamu adalah bot WhatsApp"));
  assert.ok(result.length > 50);
});

test("buildMemoryPrompt handles empty and populated memories", () => {
  const empty = buildMemoryPrompt([]);
  assert.equal(empty, "Belum ada informasi yang diketahui tentang user ini.");

  const populated = buildMemoryPrompt([
    { key: "name", value: "Joni" },
    { key: "city", value: "Bandung" },
  ]);

  assert.ok(populated.includes("- name: Joni"));
  assert.ok(populated.includes("- city: Bandung"));
});

test("buildHistoryMessages filters non user/assistant roles", () => {
  const messages = [
    { role: "user", content: "Halo" },
    { role: "assistant", content: "Hai" },
    { role: "tool", content: "ignored" },
  ];

  const result = buildHistoryMessages(messages);

  assert.deepEqual(result, [
    { role: "user", content: "Halo" },
    { role: "assistant", content: "Hai" },
  ]);
});
