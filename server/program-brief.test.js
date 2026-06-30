import assert from "node:assert/strict";
import test from "node:test";

import { buildProgramBrief } from "./program-brief.js";

test("program brief parses city editorial radio intent from conversational Chinese", () => {
  const brief = buildProgramBrief("北京晚上回家路上，想听点有故事的华语歌，可以带点新闻、热评、八卦感");

  assert.equal(brief.format, "city-editorial");
  assert.equal(brief.city, "北京");
  assert.equal(brief.timeIntent, "evening");
  assert.equal(brief.scene, "回家路上");
  assert.deepEqual(brief.musicTaste.languages, ["华语"]);
  assert.ok(brief.contentTaste.includes("stories"));
  assert.ok(brief.contentTaste.includes("hot-comments"));
  assert.ok(brief.contentTaste.includes("news"));
  assert.ok(brief.contentTaste.includes("gossip"));
  assert.equal(brief.talkDensity, "rich");
  assert.equal(brief.queueMode, "replace");
});

test("program brief keeps next-song requests as append mode", () => {
  const brief = buildProgramBrief("当前这首别打断，后面接几首李宗盛，有点故事和八卦");

  assert.equal(brief.queueMode, "append-after-current");
  assert.equal(brief.format, "city-editorial");
  assert.ok(brief.contentTaste.includes("stories"));
  assert.ok(brief.contentTaste.includes("gossip"));
});

test("program brief does not treat bare commute or workday copy as evening", () => {
  const brief = buildProgramBrief("上午工作间隙，想听一点华语、清爽、但不要太吵");

  assert.equal(brief.timeIntent, "morning");
  assert.equal(brief.scene, "工作学习");
});
