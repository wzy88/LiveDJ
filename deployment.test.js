import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const apiFunctionUrl = new URL("./api/[...path].js", import.meta.url);
const renderConfigUrl = new URL("./render.yaml", import.meta.url);
const vercelConfigUrl = new URL("./vercel.json", import.meta.url);

test("Render blueprint defines a free Node web service", () => {
  assert.equal(existsSync(renderConfigUrl), true, "render.yaml should exist");
  const source = readFileSync(renderConfigUrl, "utf8");
  assert.match(source, /type: web/);
  assert.match(source, /runtime: node/);
  assert.match(source, /plan: free/);
  assert.match(source, /startCommand: npm start/);
  assert.match(source, /healthCheckPath: \/api\/health/);
});

test("Vercel serves API requests from the in-repo Express function", () => {
  assert.equal(existsSync(apiFunctionUrl), true, "api/[...path].js should exist");
  const source = readFileSync(apiFunctionUrl, "utf8");
  assert.match(source, /from "\.\.\/server\/index\.js"/);
  assert.match(source, /app\(req, res\)/);

  const config = JSON.parse(readFileSync(vercelConfigUrl, "utf8"));
  assert.equal(config.functions?.["api/[...path].js"]?.maxDuration, 300);
  assert.deepEqual(config.rewrites || [], []);
  assert.doesNotMatch(JSON.stringify(config), /railway\.app|onrender\.com/i);
});
