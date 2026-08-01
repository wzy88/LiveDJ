import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const ensureDev = readFileSync(new URL("./ensure-dev.sh", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("local development uses one stable frontend port", () => {
  assert.match(packageJson.scripts["dev:web"], /--port 5174/);
  assert.match(packageJson.scripts["dev:web"], /--strictPort/);
  assert.match(ensureDev, /iTCP:5174/);
  assert.doesNotMatch(ensureDev, /iTCP:5173/);
  assert.match(readme, /http:\/\/127\.0\.0\.1:5174/);
});
