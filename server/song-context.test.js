import assert from "node:assert/strict";
import test from "node:test";

import { summarizeSongContext } from "./song-context.js";

test("song context summarizes hot comments as themes without raw long quotes", () => {
  const context = summarizeSongContext({
    track: { title: "旅行的意义" },
    comments: [
      "离开那座城市的时候，我在车站循环这首歌，像是在跟过去告别。",
      "有些话最后还是没说出口，像一封没寄出的信。",
      "求赞求赞，互粉打卡第一。"
    ]
  });

  assert.equal(context.provider, "netease-comments");
  assert.ok(context.hotCommentThemes.length >= 2);
  assert.equal(context.commentCount, 2);
  assert.ok(context.commentExcerpts.some((item) => item.text.includes("车站循环这首歌")));
  assert.match(context.storySummary, /旅行的意义|私人故事|告别|遗憾/);
  assert.doesNotMatch(context.storySummary, /求赞|互粉|车站循环这首歌/);
});

test("song context keeps short original comment excerpts for talk material", () => {
  const context = summarizeSongContext({
    track: { title: "旅行的意义" },
    comments: [
      "2019 年在北京西站，一个人拖着箱子听这首歌，突然觉得离开也没那么体面。",
      "这条评论很长".repeat(40),
      "网易云热评求赞。"
    ]
  });

  assert.equal(context.provider, "netease-comments");
  assert.equal(context.commentExcerpts.length, 1);
  assert.deepEqual(context.commentExcerpts[0], {
    text: "2019 年在北京西站，一个人拖着箱子听这首歌，突然觉得离开也没那么体面。",
    theme: "离开/路上/告别",
    source: "netease-hot-comment"
  });
  assert.doesNotMatch(context.storySummary, /北京西站，一个人拖着箱子/);
});

test("song context prefers concrete listener stories over quote-like comments", () => {
  const context = summarizeSongContext({
    track: { title: "于是" },
    comments: [
      "很喜欢这段话： “其实我比你更早知道我们不适合，但是我更舍不得你”",
      "歌词写得太准了，副歌那句真的封神。",
      "去年冬天在北京北站等车，耳机里正好放到这首，突然就不想发那条消息了。",
      "嘴上说着翻篇 其实偷偷折了个角"
    ]
  });

  assert.ok(context.commentExcerpts.length >= 1);
  assert.equal(context.commentExcerpts[0].text, "去年冬天在北京北站等车，耳机里正好放到这首，突然就不想发那条消息了。");
  assert.ok(context.commentExcerpts.every((item) => !/这段话|歌词|副歌|“/.test(item.text)));
});

test("song context filters unsuitable comments from quotable excerpts", () => {
  const context = summarizeSongContext({
    track: { title: "知我" },
    comments: [
      "诸君，且助我斩去我妈妈病魔，为我护法。",
      "诸位道友，可否告诉我为何喜欢这曲。",
      "妈妈拍抖音总是用很重的特效，她只觉得遮住皱纹了，自己好像又年轻了。",
      "去年冬天在北京北站等车，耳机里正好放到这首，突然就不想发那条消息了。"
    ]
  });

  const joined = context.commentExcerpts.map((item) => item.text).join("\n");
  assert.match(joined, /北京北站/);
  assert.doesNotMatch(joined, /病魔|护法|抖音|皱纹|特效|诸位|道友/);
});

test("song context does not expose lyric-like fragments as original comment excerpts", () => {
  const context = summarizeSongContext({
    track: { title: "嗜好" },
    comments: [
      "嗜好只成瘾 爱你却入魔 思你欲得你 得你惧失你",
      "我唯一的嗜好 那便是喜欢你",
      "喜欢一个不可能在一起的人是什么感觉？ 小巷 又弯又长 没有门 没有窗 我拿把旧钥匙 敲着厚厚的墙 ——顾城《小巷》",
      "“替你们试过了 能好好做朋友就别发展成恋人”",
      "唯一嗜好就是每天雷打不动的给你发一句晚安， 表白对于我这种胆小鬼来说比追风还难， 但我还是会去找一个最有可能的夜晚， 鼓起勇气将这些孤单心事告诉你， 然后祝你爱我到天荒地老。",
      "凌晨两点从公司出来，三环边风很冷，这首歌刚好播到一半。"
    ]
  });

  assert.equal(context.commentExcerpts[0].text, "凌晨两点从公司出来，三环边风很冷，这首歌刚好播到一半。");
  assert.ok(context.commentExcerpts.every((item) => item.text.length <= 70));
  assert.ok(context.commentExcerpts.every((item) => !/嗜好只成瘾|得你惧失你|顾城|小巷|替你们试过了|天荒地老/.test(item.text)));
});

test("song context drops shallow or official comments instead of paraphrasing them", () => {
  const context = summarizeSongContext({
    track: { title: "一半一半" },
    comments: [
      "感谢大家对这首歌曲这么支持 现在大家的热情反馈是我写这首歌的时候万万没有预料到的 谢谢大家",
      "在厦门别听这首歌，美女太多，容易伤春。",
      "见一面都很难的人，居然还在幻想着有以后。",
      "明天和初恋结婚啦，突然觉得这首歌好适合这一刻。"
    ]
  });

  assert.match(context.storySummary, /靠近|期待|重逢|关系/);
  assert.doesNotMatch(context.storySummary, /感谢大家|美女太多|厦门|万万没有预料/);
  assert.ok(context.hotCommentThemes.every((theme) => !theme.includes("有条评论大意是")));
  assert.equal(new Set(context.hotCommentThemes).size, context.hotCommentThemes.length);
});

test("song context keeps youth and friend comments concrete instead of one stock phrase", () => {
  const context = summarizeSongContext({
    track: { title: "一半一半" },
    comments: [
      "大学毕业那天，和室友在操场听到这首歌，后来大家去了不同城市。",
      "高中同桌分享给我的歌，现在只要前奏一响就想到那间教室。",
      "少年时候的朋友好久没联系了，但这首歌一来，很多画面都回来。"
    ]
  });

  assert.ok(context.hotCommentThemes.length >= 1);
  assert.doesNotMatch(context.storySummary, /青春、朋友和回不去的一段时间/);
  assert.match(context.storySummary, /毕业|同桌|教室|朋友|不同城市/);
});

test("song context returns empty context when comments are only noise", () => {
  const context = summarizeSongContext({
    comments: ["求赞求赞", "打卡第一", "999"]
  });

  assert.deepEqual(context.hotCommentThemes, []);
  assert.deepEqual(context.commentExcerpts, []);
  assert.equal(context.commentCount, 0);
  assert.equal(context.storySummary, "");
  assert.equal(context.provider, "");
});
