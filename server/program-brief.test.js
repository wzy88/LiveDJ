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

test("program brief parses classic energetic office anti-sleep intent", () => {
  const brief = buildProgramBrief("我想听经典老歌，给我推荐一些，最好节奏感强一点，不然下午办公会犯困。");

  assert.equal(brief.timeIntent, "afternoon");
  assert.equal(brief.scene, "工作学习");
  assert.ok(brief.mood.includes("提神"));
  assert.ok(brief.mood.includes("节奏感"));
  assert.ok(brief.musicTaste.eras.includes("经典老歌"));
  assert.ok(brief.musicTaste.energy.includes("节奏感强"));
  assert.ok(brief.useCase.includes("办公防困"));
});

test("program brief treats overtime as work scene without forcing evening", () => {
  const brief = buildProgramBrief("我现在在加班，播点音乐");

  assert.equal(brief.format, "personal-companion");
  assert.equal(brief.city, "");
  assert.equal(brief.timeIntent, "current");
  assert.equal(brief.scene, "工作学习");
});

test("program brief parses cycling goal as movement scene", () => {
  const brief = buildProgramBrief("我在骑自行车，来点音乐，今天的目标是30Km。");

  assert.equal(brief.format, "personal-companion");
  assert.equal(brief.scene, "骑行");
  assert.ok(brief.mood.includes("节奏感"));
  assert.ok(brief.useCase.includes("骑行陪伴"));
});
