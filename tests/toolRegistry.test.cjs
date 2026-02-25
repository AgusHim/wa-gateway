const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clearTools,
  registerTool,
  getToolDeclarations,
  executeTool,
} = require("../src/agent/tools/registry");

test("tool registry registers and executes a tool", async () => {
  clearTools();

  registerTool({
    name: "sum_two",
    description: "Sum two numbers",
    parameters: {
      type: "object",
      properties: {
        a: { type: "string", description: "A" },
        b: { type: "string", description: "B" },
      },
      required: ["a", "b"],
    },
    async execute(params) {
      return String(Number(params.a) + Number(params.b));
    },
  });

  const declarations = getToolDeclarations();
  assert.equal(declarations.length, 1);
  assert.equal(declarations[0].type, "function");
  assert.equal(declarations[0].function.name, "sum_two");

  const result = await executeTool(
    "sum_two",
    { a: "4", b: "6" },
    { userId: "u1", phoneNumber: "628111" }
  );

  assert.equal(result, "10");
});
