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

test("recommend shapes top results like a radio queue instead of a flat score list", () => {
  const result = recommend({ query: "下班路上，想听一点华语、松弛、但不要太丧", limit: 10 });
  const top = result.recommendations.slice(0, 8);

  assert.ok(top.length >= 8);

  const mainMoods = top.map((track) => track.moods?.[0]?.value).filter(Boolean);
  const mainGenres = top.map((track) => track.genres?.[1]?.value || track.genres?.[0]?.value).filter(Boolean);
  const artists = top.map((track) => String(track.artist || "").split(/[\/,&，、]/)[0].trim()).filter(Boolean);

  assert.ok(new Set(mainMoods).size >= 3, `expected at least 3 lead moods in first 8, got ${mainMoods.join(", ")}`);
  assert.ok(new Set(mainGenres).size >= 3, `expected at least 3 lead genres in first 8, got ${mainGenres.join(", ")}`);
  assert.equal(new Set(artists.slice(0, 6)).size, artists.slice(0, 6).length, "first 6 should avoid repeated lead artists");

  const topScore = top[0].recommendScore;
  const lowRelevance = top.slice(0, 8).filter((track) => track.recommendScore < topScore * 0.36);
  assert.deepEqual(
    lowRelevance.map((track) => `${track.title} - ${track.artist}`),
    [],
    "first 8 should not sacrifice relevance just to create variety"
  );
});

test("recommend honors explicit artist requests in conversational Chinese", () => {
  const result = recommend({ query: "我说播放李宗盛的音乐", limit: 8 });
  const topArtists = result.recommendations.slice(0, 5).map((track) => track.artist).join("\n");

  assert.match(result.recommendations[0]?.artist || "", /李宗盛/, `expected first recommendation to be 李宗盛, got:\n${topArtists}`);
  assert.ok(
    result.recommendations.slice(0, 5).filter((track) => /李宗盛/.test(track.artist)).length >= 3,
    `expected explicit artist to dominate top recommendations, got:\n${topArtists}`
  );
});

test("recommend honors explicit genre requests over imported playlist taste", () => {
  const result = recommend({ query: "我想听民谣", limit: 8, refreshSeed: "explicit-folk-test" });
  const top = result.recommendations.slice(0, 5);
  const debug = top.map((track) => `${track.title} - ${track.artist} | ${(track.genres || []).map((item) => item.value).join("/")}`).join("\n");

  assert.ok((top[0]?.genres || []).some((genre) => genre.value === "民谣"), `expected first recommendation to be folk, got:\n${debug}`);
  assert.ok(
    top.filter((track) => (track.genres || []).some((genre) => genre.value === "民谣")).length >= 4,
    `expected explicit genre to dominate top recommendations, got:\n${debug}`
  );
});

test("recommend honors explicit language requests over imported playlist taste", () => {
  const result = recommend({ query: "我想听粤语歌", limit: 8, refreshSeed: "explicit-cantonese-test" });
  const top = result.recommendations.slice(0, 5);
  const debug = top.map((track) => `${track.title} - ${track.artist} | ${(track.genres || []).map((item) => item.value).join("/")} | ${(track.languages || []).map((item) => item.value).join("/")}`).join("\n");

  assert.ok(hasValue(top[0], "genres", "粤语") || hasValue(top[0], "languages", "粤语"), `expected first recommendation to be Cantonese, got:\n${debug}`);
  assert.ok(
    top.filter((track) => hasValue(track, "genres", "粤语") || hasValue(track, "languages", "粤语")).length >= 4,
    `expected explicit language to dominate top recommendations, got:\n${debug}`
  );
});

function hasValue(track, key, value) {
  return (track?.[key] || []).some((item) => item.value === value);
}
