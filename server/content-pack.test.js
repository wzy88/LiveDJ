import assert from "node:assert/strict";
import test from "node:test";

import { buildProgramBrief } from "./program-brief.js";
import { buildTrackContentPack, buildShowTalkPlan } from "./content-pack.js";

test("content pack combines song facts, selection reason, story, and editorial context", () => {
  const brief = buildProgramBrief("北京晚上回家路上，想听点有故事的华语歌，可以带点新闻、热评、八卦感");
  const pack = buildTrackContentPack({
    track: {
      title: "旅行的意义",
      artist: "陈绮贞",
      programSlot: "story",
      programSlotLabel: "故事段",
      programReason: "这一首更适合承接热评、故事和私人记忆",
      moods: [{ value: "温柔", weight: 10 }],
      scenes: [{ value: "路上", weight: 9 }],
      genres: [{ value: "民谣", weight: 8 }],
      evidence: ["场景匹配：路上"]
    },
    brief,
    songContext: {
      provider: "netease-comments",
      hotCommentThemes: ["有人把它听成一段关于离开、路上和告别的故事"],
      commentExcerpts: [
        {
          text: "在北京西站，一个人拖着箱子听这首歌。",
          theme: "离开/路上/告别",
          source: "netease-hot-comment"
        }
      ],
      storySummary: "《旅行的意义》下面的评论更像一组私人故事：有人把它听成一段关于离开、路上和告别的故事。"
    },
    artistContext: {
      provider: "netease-artist",
      name: "陈绮贞",
      brief: "台湾创作女歌手，以清澈嗓音和民谣气质受到关注。",
      facts: ["作品常与旅行、城市和私人记忆有关。"]
    },
    broadcastContext: {
      city: "北京",
      timeCue: "今晚",
      localSceneSummary: "北京今晚的通勤尾声还挂在地铁和环路上。",
      newsBriefs: [{ text: "城市更新和夜间消费的话题这两天还在被讨论", source: "test-editorial" }],
      cultureBriefs: [{ text: "Livehouse和展览把周中的北京抬亮一点", source: "test-editorial" }],
      editorialAngles: ["通勤后的私人时间"]
    },
    previousTrack: { title: "一半一半", moods: [{ value: "情绪" }] },
    nextTrack: { title: "海屿你", moods: [{ value: "明亮" }] }
  });

  assert.equal(pack.songFacts.title, "旅行的意义");
  assert.equal(pack.programSlot, "story");
  assert.match(pack.selectionReason, /热评|故事|私人记忆/);
  assert.match(pack.story.storySummary, /告别/);
  assert.equal(pack.story.commentExcerpts[0].text, "在北京西站，一个人拖着箱子听这首歌。");
  assert.match(pack.artist.brief, /清澈嗓音|民谣气质/);
  assert.equal(pack.editorial.city, "北京");
  assert.match(pack.editorial.localSceneSummary, /地铁和环路/);
  assert.match(pack.transitionRole, /一半一半|海屿你|情绪|明亮/);
});

test("show talk plan gives the whole program a thesis and avoids repeated stock phrasing", () => {
  const brief = buildProgramBrief("北京晚上回家路上，想听点有故事的华语歌，可以带点新闻、热评、八卦感");
  const plan = buildShowTalkPlan({
    brief,
    packs: [
      { songFacts: { title: "一半一半" }, programSlot: "opener", selectionReason: "开场" },
      { songFacts: { title: "旅行的意义" }, programSlot: "story", selectionReason: "故事段" }
    ]
  });

  assert.match(plan.showThesis, /北京|城市|回家|节目/);
  assert.equal(plan.tone, "城市编辑型，但像朋友在旁边说话");
  assert.equal(plan.voiceProfile.id, "city-music-editor-friend");
  assert.match(plan.voiceProfile.label, /城市音乐编辑|朋友低声/);
  assert.ok(plan.recurringMotifs.some((item) => /地铁|环路|下班|评论|资讯/.test(item)));
  assert.notDeepEqual(plan.recurringMotifs, ["通勤后的私人时间", "耳机里的自留地", "信息很多但心要慢一点"]);
  assert.ok(plan.avoidPhrases.includes("今晚这一段"));
  assert.equal(plan.tracks.length, 2);
  assert.match(plan.tracks[1].talkAngle, /故事|热评|私人/);
});
