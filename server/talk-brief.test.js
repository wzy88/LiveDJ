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
  assert.equal(brief.programFunction, "answer_why_this_song_now");
  assert.equal(brief.primaryAngle, "user_scene");
  assert.deepEqual(brief.requiredMaterials.slice(0, 4), ["user_scene", "song_reason", "current_track", "concrete_material"]);
  assert.equal(brief.talkStrategy, "material_anchored");
  assert.match(brief.segmentJobs.opening, /场景|动作|时间|声音|必要时/);
  assert.doesNotMatch(brief.segmentJobs.opening, /立刻点出歌名或歌手/);
  assert.match(brief.segmentJobs.bridge, /素材|判断/);
  assert.match(brief.segmentJobs.nextTease, /下一首|接/);
  assert.match(brief.qualityGate.join(" "), /用户诉求|当前歌曲|素材|拒稿/);
});

test("talk brief uses scene-first strategy for plain situation prompts", () => {
  const brief = buildTalkBrief({
    query: "我现在在加班，播点音乐",
    queueIndex: 0,
    track: {
      title: "Rollin' On",
      artist: "椅子乐团",
      scenes: [{ value: "工作" }],
      moods: [{ value: "松弛" }]
    },
    brief: {
      scene: "工作学习",
      mood: ["松弛"]
    }
  });

  assert.equal(brief.talkStrategy, "scene_first");
  assert.equal(brief.programFunction, "companion_scene_progression");
  assert.match(brief.segmentJobs.opening, /状态|动作|时间|声音/);
  assert.match(brief.segmentJobs.bridge, /动作|身体|目标|环境/);
  assert.match(brief.writingTask, /陪用户经历这个时刻/);
  assert.match(brief.qualityGate.join(" "), /不要复读用户场景词/);
  assert.match(brief.qualityGate.join(" "), /场景是底色/);
  assert.doesNotMatch(brief.writingTask, /为什么此刻放这首歌/);
  assert.doesNotMatch(brief.segmentJobs.opening, /立刻点出歌名或歌手/);
});

test("talk brief treats cycling goals as scene progression, not song-fit proof", () => {
  const brief = buildTalkBrief({
    query: "我在骑自行车，来点音乐，今天的目标是30Km。",
    queueIndex: 0,
    track: {
      title: "一半一半",
      artist: "Top Barry / INDEcompany",
      scenes: [{ value: "骑行" }],
      moods: [{ value: "明亮" }],
      genres: [{ value: "R&B" }]
    },
    brief: {
      format: "personal-companion",
      scene: "骑行",
      contentTaste: [],
      musicTaste: { energy: [] },
      useCase: ["骑行陪伴"]
    }
  });

  assert.equal(brief.talkStrategy, "scene_first");
  assert.equal(brief.programFunction, "companion_scene_progression");
  assert.match(brief.segmentJobs.bridge, /动作|身体|目标|环境/);
  assert.match(brief.qualityGate.join(" "), /音乐只点到一两次/);
  assert.doesNotMatch(brief.writingTask, /证明|为什么此刻放这首歌/);
});

test("plain activity prompts stay scene-first even when artist context is available", () => {
  const brief = buildTalkBrief({
    query: "我在骑自行车，来点音乐，今天的目标是30Km。",
    track: {
      title: "海屿你",
      artist: "马也_Crabbit",
      scenes: [{ value: "骑行" }],
      moods: [{ value: "明亮" }]
    },
    brief: {
      format: "personal-companion",
      scene: "骑行",
      contentTaste: [],
      musicTaste: { energy: [] },
      useCase: ["骑行陪伴"]
    },
    contentPack: {
      artist: {
        name: "马也_Crabbit",
        brief: "聚声匠主理人"
      },
      research: {
        audibleCues: ["R&B低频"]
      }
    }
  });

  assert.equal(brief.talkStrategy, "scene_first");
  assert.equal(brief.programFunction, "companion_scene_progression");
});

test("talk brief turns the program clock callback into a continuity writing job", () => {
  const brief = buildTalkBrief({
    query: "我现在在加班，播点音乐",
    queueIndex: 2,
    track: {
      title: "Rollin' On",
      artist: "椅子乐团",
      scenes: [{ value: "工作" }],
      moods: [{ value: "松弛" }]
    },
    brief: {
      format: "personal-companion",
      scene: "工作学习",
      contentTaste: []
    },
    programClock: {
      role: "callback",
      label: "前文回声",
      playedFields: ["opening"],
      writingInstruction: "承认时间已经过去，呼应前面说过的动作、状态或环境，让听众感到你记得。"
    }
  });

  assert.equal(brief.programClock.role, "callback");
  assert.equal(brief.programClock.label, "前文回声");
  assert.deepEqual(brief.programClock.playedFields, ["opening"]);
  assert.match(brief.programClock.writingInstruction, /时间已经过去|呼应|记得/);
  assert.match(brief.writingTask, /前文回声|时间已经过去|呼应/);
});
