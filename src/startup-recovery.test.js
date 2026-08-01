import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");

test("startup stops cleanly when graph stats are unavailable", () => {
  assert.match(mainSource, /Number\.isFinite\(stats\?\.songCount\)/);
  assert.match(mainSource, /电台服务暂时不可用/);
});
