const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertInstagramLaunchModeAllowsWorkspace,
  resolveInstagramLaunchMode,
} = require("../src/lib/integrations/instagram/launchMode");

const previousEnv = {
  INSTAGRAM_APP_MODE: process.env.INSTAGRAM_APP_MODE,
  INSTAGRAM_DEV_MODE_ALLOWED_WORKSPACES: process.env.INSTAGRAM_DEV_MODE_ALLOWED_WORKSPACES,
};

test("instagram launch mode enables fallback for non-allowlisted workspace in development mode", () => {
  process.env.INSTAGRAM_APP_MODE = "development";
  process.env.INSTAGRAM_DEV_MODE_ALLOWED_WORKSPACES = "ws-pilot";

  const snapshot = resolveInstagramLaunchMode("ws-random");
  assert.equal(snapshot.appMode, "development");
  assert.equal(snapshot.workspaceAllowed, false);
  assert.equal(snapshot.fallbackActive, true);
  assert.match(snapshot.message, /development mode/i);
});

test("instagram launch mode allows allowlisted workspace in development mode", () => {
  process.env.INSTAGRAM_APP_MODE = "development";
  process.env.INSTAGRAM_DEV_MODE_ALLOWED_WORKSPACES = "ws-pilot,ws-canary";

  const snapshot = resolveInstagramLaunchMode("ws-canary");
  assert.equal(snapshot.workspaceAllowed, true);
  assert.equal(snapshot.fallbackActive, false);
  assert.doesNotThrow(() => assertInstagramLaunchModeAllowsWorkspace("ws-canary"));
});

test("instagram launch mode defaults to live", () => {
  delete process.env.INSTAGRAM_APP_MODE;
  delete process.env.INSTAGRAM_DEV_MODE_ALLOWED_WORKSPACES;

  const snapshot = resolveInstagramLaunchMode("ws-any");
  assert.equal(snapshot.appMode, "live");
  assert.equal(snapshot.workspaceAllowed, true);
  assert.equal(snapshot.fallbackActive, false);
});

test("instagram launch mode guard rejects non-allowlisted workspace in development mode", () => {
  process.env.INSTAGRAM_APP_MODE = "development";
  process.env.INSTAGRAM_DEV_MODE_ALLOWED_WORKSPACES = "ws-pilot";

  assert.throws(
    () => assertInstagramLaunchModeAllowsWorkspace("ws-prod"),
    /development mode/i
  );
});

process.on("exit", () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});
