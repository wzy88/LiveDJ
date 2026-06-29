import assert from "node:assert/strict";
import test from "node:test";

import { buildTalkBrief } from "./talk-brief.js";

test("talk brief turns user prompt, song material, and Beijing context into an editorial writing brief", () => {
  const brief = buildTalkBrief({
    query: "凤凰传奇，开车，北京，犯困。口播里可以带天气新闻娱乐八卦、轻松陪伴、评论热评和创作背景。",
    queueIndex: 0,
    track: {
      title: "最炫民族风",
      artist: "凤凰传奇",
      scenes: [{ value: "开车" }, { value: "通勤" }],
      moods: [{ value: "提神" }, { value: "明亮" }],
      genres: [{ value: "华语流行" }],
      evidence: ["这次点名想听：凤凰传奇"]
    },
    nextTrack: {
      title: "自由飞翔",
      artist: "凤凰传奇"
    },
    brief: {
      city: "北京",
      scene: "通勤路上",
      contentTaste: ["stories", "hot-comments", "news", "gossip"]
    },
    contentPack: {
      selectionReason: "用户点名凤凰传奇，并且需要开车犯困时提神",
      story: {
        hotCommentThemes: ["很多人把它当成开车提神和聚会热场的歌"],
        commentExcerpts: [{ text: "一听这个前奏，方向盘都想跟着打拍子。", theme: "开车/提神" }],
        storySummary: "评论里常见的是熟悉、提神和国民旋律带来的集体记忆。"
      },
      artist: {
        name: "凤凰传奇",
        brief: "凤凰传奇长期横跨大众流行、广场舞和年轻人的二创语境。",
        facts: ["近年舞台和短视频二创让他们重新进入年轻人的播放列表。"]
      },
      editorial: {
        city: "北京",
        localSceneSummary: "北京晚高峰还压在环路和高架上。",
        newsBriefs: ["北京近期夜间消费和演出活动热度还在。"],
        cultureBriefs: ["演出、综艺舞台和短视频二创让老歌不断翻红。"],
        editorialAngles: ["开车犯困时要提神但不能吵到驾驶注意力"]
      }
    },
    broadcastContext: {
      city: "北京",
      timeCue: "今晚",
      weatherSummary: "北京今晚少云，风不大。",
      newsBriefs: ["城市夜生活和演出消费还在被讨论。"],
      cultureBriefs: ["音乐综艺和短视频二创继续带火老歌。"],
      editorialAngles: ["开车犯困要提神"]
    }
  });

  assert.deepEqual(brief.userKeywords.artists, ["凤凰传奇"]);
  assert.deepEqual(brief.userKeywords.city, ["北京"]);
  assert.match(brief.userKeywords.scene.join(" "), /开车|通勤/);
  assert.match(brief.userKeywords.mood.join(" "), /犯困|提神/);
  assert.match(brief.userKeywords.content.join(" "), /天气|新闻|八卦|热评|创作背景/);
  assert.match(brief.currentTrack.materialSummary, /最炫民族风|凤凰传奇|提神/);
  assert.match(brief.materials.story, /方向盘|评论|集体记忆/);
  assert.match(brief.materials.artist, /大众流行|广场舞|二创/);
  assert.match(brief.materials.cityEditorial, /北京|少云|夜间消费|开车犯困/);
  assert.match(brief.writingTask, /200-300字以内|用户命题|热评|资讯|不要空泛/);
  assert.match(brief.mustMention.join(" "), /凤凰传奇|北京|开车|犯困|最炫民族风/);
});
