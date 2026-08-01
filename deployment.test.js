import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

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

test("Vercel API rewrite points at the Render backend instead of retired Railway", () => {
  const config = JSON.parse(readFileSync(vercelConfigUrl, "utf8"));
  const destination = config.rewrites?.[0]?.destination || "";
  assert.equal(destination, "https://claudio-radio-web-wzy88-api.onrender.com/api/:path*");
  assert.doesNotMatch(destination, /railway\.app/i);
});
