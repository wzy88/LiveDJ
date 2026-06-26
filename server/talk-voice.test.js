import assert from "node:assert/strict";
import test from "node:test";

import { buildTalkVoiceProfile, getTalkVoiceProfile, scoreTalkLineQuality } from "./talk-voice.js";
import { buildProgramBrief } from "./program-brief.js";

test("default talk voice is city music editor with low-voice friend warmth", () => {
  const profile = getTalkVoiceProfile("default");

  assert.equal(profile.id, "city-music-editor-friend");
  assert.match(profile.label, /城市音乐编辑|朋友低声/);
  assert.ok(profile.materialPriority.includes("songFacts"));
  assert.ok(profile.materialPriority.includes("songContext"));
  assert.ok(profile.materialPriority.includes("broadcastContext"));
  assert.ok(profile.bannedPhrases.includes("情绪路线"));
  assert.ok(profile.bannedPhrases.includes("自留地"));
  assert.ok(profile.lineRules.openingMinChars >= 34);
  assert.ok(profile.lineRules.openingMaxChars <= 110);
});

test("talk voice profile adapts to a city editorial brief without changing the default voice", () => {
  const brief = buildProgramBrief("北京晚上回家路上，想听点有故事的华语歌，可以带点新闻、热评、八卦感");
  const profile = buildTalkVoiceProfile(brief);

  assert.equal(profile.id, "city-music-editor-friend");
  assert.match(profile.styleDirective, /歌名|歌手|北京|地铁口|评论|资讯/);
  assert.equal(profile.talkDensity, "rich");
  assert.ok(profile.mustMention.some((item) => /歌名/.test(item)));
  assert.ok(profile.mustUseWhenAvailable.some((item) => /评论/.test(item)));
});

test("talk line quality flags abstract or template-like copy", () => {
  const profile = getTalkVoiceProfile("default");

  const bad = scoreTalkLineQuality("今晚的情绪路线很稳，慢慢听。", profile);
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.some((reason) => /禁用词|抽象/.test(reason)));

  const template = scoreTalkLineQuality("《海屿你》放在这里，重点不是煽情，而是让夜晚里的脚步有个能跟上的拍子。", profile);
  assert.equal(template.ok, false);
  assert.ok(template.reasons.some((reason) => /模板/.test(reason)));

  const good = scoreTalkLineQuality("《旅行的意义》放在北京晚上回家的地铁口，会把评论里那点告别说得更具体。", profile);
  assert.equal(good.ok, true, good.reasons.join("\n"));
});
