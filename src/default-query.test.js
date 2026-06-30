import assert from "node:assert/strict";
import test from "node:test";

import { buildDefaultRadioQuery } from "./default-query.js";

test("default radio query matches morning instead of hardcoding evening commute", () => {
  const query = buildDefaultRadioQuery(new Date("2026-06-30T10:06:00+08:00"));

  assert.match(query, /上午|工作间隙/);
  assert.doesNotMatch(query, /今晚|下班|回家路上/);
});

test("default radio query only uses evening commute after work hours", () => {
  const query = buildDefaultRadioQuery(new Date("2026-06-30T20:06:00+08:00"));

  assert.match(query, /晚上|回家路上/);
  assert.doesNotMatch(query, /上午|早上/);
});
