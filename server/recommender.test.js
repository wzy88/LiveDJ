import assert from "node:assert/strict";
import test from "node:test";

import { recommend } from "./recommender.js";

test("recommend can reroll away from the current queue", () => {
  const first = recommend({ query: "下班松弛", limit: 10 });
  const firstIds = first.recommendations.map((track) => track.id);
  assert.ok(firstIds.length >= 6);

  const rerolled = recommend({
    query: "下班松弛",
    limit: 10,
    refreshSeed: "manual-reroll-test",
    avoidIds: firstIds.slice(0, 6)
  });
  const rerolledIds = rerolled.recommendations.map((track) => track.id);
  const overlap = rerolledIds.slice(0, 6).filter((id) => firstIds.slice(0, 6).includes(id));

  assert.ok(rerolledIds.length >= 6);
  assert.notDeepEqual(rerolledIds.slice(0, 6), firstIds.slice(0, 6));
  assert.ok(overlap.length <= 2, `expected reroll to move away from current queue, got overlap: ${overlap.join(", ")}`);
});
