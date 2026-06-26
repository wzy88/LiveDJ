import assert from "node:assert/strict";
import test from "node:test";

import { buildProgramBrief } from "./program-brief.js";
import { planRadioQueue } from "./queue-planner.js";

test("queue planner assigns city-editorial radio slots and reasons", () => {
  const brief = buildProgramBrief("北京晚上回家路上，想听点有故事的华语歌，可以带点新闻、热评、八卦感");
  const planned = planRadioQueue({
    candidates: [
      makeSong("a", "开场歌", "歌手A", { moods: ["松弛"], scenes: ["通勤"], genres: ["流行"], score: 98 }),
      makeSong("b", "故事歌", "歌手B", { moods: ["温柔"], scenes: ["夜晚"], genres: ["民谣"], score: 92, story: true }),
      makeSong("c", "城市歌", "歌手C", { moods: ["有故事"], scenes: ["北京", "夜晚"], genres: ["流行"], score: 86 }),
      makeSong("d", "转向歌", "歌手D", { moods: ["明亮"], scenes: ["路上"], genres: ["R&B"], score: 84 }),
      makeSong("e", "收尾歌", "歌手E", { moods: ["安静"], scenes: ["深夜"], genres: ["民谣"], score: 78 })
    ],
    brief,
    limit: 5
  });

  assert.deepEqual(planned.map((track) => track.programSlot), ["opener", "story", "turn", "city", "closer"]);
  assert.ok(planned.every((track) => track.programReason));
  assert.equal(planned[1].title, "故事歌");
  assert.equal(planned[3].title, "城市歌");
});

test("queue planner preserves explicit artist candidates at the front", () => {
  const brief = buildProgramBrief("后面接几首李宗盛，要有故事");
  const planned = planRadioQueue({
    candidates: [
      makeSong("a", "普通歌", "歌手A", { moods: ["松弛"], scenes: ["夜晚"], genres: ["流行"], score: 120 }),
      makeSong("b", "山丘", "李宗盛", { moods: ["有故事"], scenes: ["夜晚"], genres: ["流行"], score: 80, explicit: true }),
      makeSong("c", "给自己的歌", "李宗盛", { moods: ["情绪"], scenes: ["深夜"], genres: ["流行"], score: 79, explicit: true })
    ],
    brief,
    limit: 3
  });

  assert.match(planned[0].artist, /李宗盛/);
  assert.equal(planned[0].programSlot, "opener");
  assert.match(planned[0].programReason, /点名|开场/);
});

function makeSong(id, title, artist, { moods = [], scenes = [], genres = [], score = 50, story = false, explicit = false } = {}) {
  return {
    id,
    title,
    artist,
    recommendScore: score,
    moods: moods.map((value, index) => ({ value, weight: 10 - index })),
    scenes: scenes.map((value, index) => ({ value, weight: 10 - index })),
    genres: genres.map((value, index) => ({ value, weight: 10 - index })),
    evidence: [
      story ? "热评故事素材充足" : "",
      explicit ? "这次点名想听李宗盛" : ""
    ].filter(Boolean)
  };
}
