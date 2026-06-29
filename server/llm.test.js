import assert from "node:assert/strict";
import test from "node:test";

process.env.LLM_API_KEY = process.env.LLM_API_KEY || "test-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "test-model";

const { generateDialogueReplyWithLlm, generateTalkScriptWithLlm } = await import("./llm.js");
const { buildTalkVoiceProfile } = await import("./talk-voice.js");

test("dialogue reply falls back to concrete queue copy when LLM returns abstract radio wording", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "music",
                reply: "今晚的情绪路线很稳，慢慢听。"
              })
            }
          }
        ]
      };
    }
  });

  const result = await generateDialogueReplyWithLlm({
    message: "我想听民谣",
    queue: [
      { title: "旅行的意义", artist: "陈绮贞" },
      { title: "南山南", artist: "马頔" },
      { title: "董小姐", artist: "宋冬野" }
    ]
  });

  assert.equal(result.intent, "music");
  assert.match(result.reply, /旅行的意义|陈绮贞/);
  assert.match(result.reply, /南山南|董小姐/);
  assert.doesNotMatch(result.reply, /情绪路线|慢慢听|很稳|气口|主线|接住|往下走/);
});

test("dialogue fallback uses plain concrete music wording", async () => {
  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  const result = await generateDialogueReplyWithLlm({
    message: "后面想听一点粤语歌",
    activeTrack: { title: "海阔天空", artist: "Beyond" },
    queue: [
      { title: "富士山下", artist: "陈奕迅" },
      { title: "一生所爱", artist: "卢冠廷" }
    ]
  });

  assert.equal(result.intent, "music");
  assert.match(result.reply, /富士山下|陈奕迅/);
  assert.doesNotMatch(result.reply, /情绪|曲风和可播音源|情绪路线|慢慢听|接住/);
});

test("dialogue reply never promises songs outside the prepared queue", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "music",
                reply: "好嘞，民谣走起！你歌单里已经有《南山南》和《董小姐》了，我再加一首赵雷的《成都》。"
              })
            }
          }
        ]
      };
    }
  });

  const result = await generateDialogueReplyWithLlm({
    message: "我想听民谣",
    queue: [
      { title: "旅行的意义", artist: "陈绮贞" },
      { title: "南山南", artist: "马頔" },
      { title: "董小姐", artist: "宋冬野" }
    ]
  });

  assert.match(result.reply, /旅行的意义/);
  assert.match(result.reply, /南山南|董小姐/);
  assert.doesNotMatch(result.reply, /成都|赵雷|我再加/);
});

test("talk script sanitizer removes lyric quotes and raw public playlist names", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                opening: "刚下班吧？这首《海屿你》从你导入的歌单里跳出来，收尾那句“你离开我，就是旅行的意义”很适合现在。",
                bridges: [
                  "歌词里那句“Follow”不要讲太满，先把情绪放低一点。",
                  "你导入的歌单里那些旋律，其实都在等这样一首歌来串起。"
                ],
                nextTease: "下一首《旅行的意义》，也来自你的歌单，等这首歌尾巴那句“爱”收住，我们接到它。",
                closing: "从「温柔予你」转出来。"
              })
            }
          }
        ]
      };
    }
  });

  const script = await generateTalkScriptWithLlm({
    track: {
      title: "旅行的意义",
      artist: "陈绮贞",
      evidence: ["和你导入的歌单接近"],
      sources: [{ title: "温柔予你" }, { title: "旋律陷阱" }]
    },
    context: {
      query: "根据我导入的歌单来一段，少讲大道理",
      nextTrack: {
        title: "旅行的意义",
        artist: "陈绮贞",
        evidence: ["和你歌单里的《夜车》常在同类公开歌单共现"]
      }
    },
    fallbackScript: {
      opening: "先从这首开始。",
      bridges: ["这里少讲一点。"],
      nextTease: "后面继续顺着走。",
      closing: ""
    }
  });

  assert.ok(script);
  const joined = script.lines.join("\n");
  assert.doesNotMatch(joined, /收尾那句|歌词里那句|歌尾巴那句/);
  assert.doesNotMatch(joined, /“[^”]+”/);
  assert.doesNotMatch(joined, /温柔予你|旋律陷阱/);
  assert.doesNotMatch(joined, /从你导入的歌单里|你导入的歌单里/);
  assert.doesNotMatch(joined, /下一首[\s\S]{0,60}来自(?:你导入的|你的)歌单/);
});

test("talk script sanitizer does not project direct import evidence onto next track", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                opening: "这首歌来自你导入的歌单，先把夜晚放轻一点。",
                bridges: ["它和《夜车》的气质靠得很近。"],
                nextTease: "下一首《旅行的意义》，也来自你的歌单，会把这口气接到路上。",
                closing: ""
              })
            }
          }
        ]
      };
    }
  });

  const script = await generateTalkScriptWithLlm({
    track: {
      title: "海屿你",
      artist: "马也_Crabbit",
      evidence: ["来自你导入的歌单"],
      sources: []
    },
    context: {
      query: "下班松弛",
      nextTrack: {
        title: "旅行的意义",
        artist: "陈绮贞",
        evidence: ["和你歌单里的《夜车》常在同类公开歌单共现"]
      }
    },
    fallbackScript: {
      opening: "这首先接住你。",
      bridges: ["这里慢一点。"],
      nextTease: "下一首继续顺着走。",
      closing: ""
    }
  });

  assert.ok(script);
  assert.match(script.opening, /来自你导入的歌单/);
  assert.doesNotMatch(script.nextTease, /下一首[\s\S]{0,60}来自(?:你导入的|你的)歌单/);
});

test("talk script sanitizer anchors generic LLM copy to current and next tracks", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                opening: "这段先把今天放轻一点，不急着回答任何问题。",
                bridges: ["让身体慢下来，耳朵先找到一个舒服的位置。"],
                nextTease: "后面会继续顺着这个气口往下走。",
                closing: ""
              })
            }
          }
        ]
      };
    }
  });

  const script = await generateTalkScriptWithLlm({
    track: {
      title: "一半一半",
      artist: "Top Barry / INDEcompany",
      evidence: ["情绪匹配：温柔"],
      sources: []
    },
    context: {
      query: "下班松弛",
      nextTrack: {
        title: "遇见",
        artist: "孙燕姿",
        evidence: ["情绪匹配：温柔"]
      }
    },
    fallbackScript: {
      opening: "先从这首开始。",
      bridges: ["这里慢一点。"],
      nextTease: "下一首继续顺着走。",
      closing: ""
    }
  });

  assert.ok(script);
  assert.match(script.opening, /一半一半|Top Barry|INDEcompany/);
  assert.match(script.nextTease, /遇见|孙燕姿/);
});

test("talk script prompt passes song story context and allows short cleaned comment excerpts", async () => {
  let capturedPayload = null;
  globalThis.fetch = async (_url, options) => {
    capturedPayload = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  opening: "《旅行的意义》和陈绮贞先把路上的气口放慢一点。",
                  bridges: [
                    "评论里的故事更像一段没说完的告别，我们只借它留下来的余温，不复述任何原话。"
                  ],
                  nextTease: "下一首继续往前走。",
                  closing: ""
                })
              }
            }
          ]
        };
      }
    };
  };

  await generateTalkScriptWithLlm({
    track: {
      title: "旅行的意义",
      artist: "陈绮贞",
      evidence: ["情绪匹配：温柔"],
      sources: []
    },
    context: {
      query: "下班路上",
      songContext: {
        commentCount: 6,
        commentExcerpts: [
          {
            text: "在北京西站，一个人拖着箱子听这首歌。",
            theme: "离开/路上/告别",
            source: "netease-hot-comment"
          }
        ],
        hotCommentThemes: ["有人把它当成离开一座城市前的告别"],
        storySummary: "评论里最动人的部分，是很多人借这首歌安放没有说完的告别。"
      }
    },
    fallbackScript: {
      opening: "先从这首开始。",
      bridges: ["这里慢一点。"],
      nextTease: "后面继续顺着走。",
      closing: ""
    }
  });

  const systemPrompt = capturedPayload.messages[0].content;
  const userPayload = JSON.parse(capturedPayload.messages[1].content);
  assert.equal(userPayload.songContext.commentCount, 6);
  assert.deepEqual(userPayload.songContext.commentExcerpts, [
    {
      text: "在北京西站，一个人拖着箱子听这首歌。",
      theme: "离开/路上/告别",
      source: "netease-hot-comment"
    }
  ]);
  assert.deepEqual(userPayload.songContext.hotCommentThemes, ["有人把它当成离开一座城市前的告别"]);
  assert.match(userPayload.songContext.storySummary, /没有说完的告别/);
  assert.match(systemPrompt, /commentExcerpts|允许短引用|不要编造/);
  assert.match(systemPrompt, /不要直接引用歌词/);
});

test("talk script sanitizer does not label non-comment material as a quoted comment", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                opening: "《于是》和郑润泽先把北京晚高峰放进耳机。",
                bridges: [
                  "评论里有一句：北京胡同口的夜风开始松了，歌可以放在写字楼灯暗下去之后的那段路。",
                  "评论里有一句：你也改不掉一难过就听歌的习惯吗。"
                ],
                nextTease: "下一首继续接。",
                closing: ""
              })
            }
          }
        ]
      };
    }
  });

  const script = await generateTalkScriptWithLlm({
    track: {
      title: "于是",
      artist: "郑润泽",
      evidence: ["用户想听有故事的民谣"],
      sources: []
    },
    context: {
      query: "北京晚上回家路上，想听点有故事的歌",
      songContext: {
        commentExcerpts: [
          { text: "你也改不掉一难过就听歌的习惯吗", theme: "听众故事", source: "netease-hot-comment" }
        ]
      },
      broadcastContext: {
        city: "北京",
        localSceneSummary: "北京胡同口的夜风开始松了，写字楼的灯慢慢暗下去。"
      }
    },
    fallbackScript: {
      opening: "先从这首开始。",
      bridges: ["这里慢一点。"],
      nextTease: "后面继续顺着走。",
      closing: ""
    },
    timeoutMs: 1000
  });

  const joined = script.lines.join("\n");
  assert.doesNotMatch(joined, /评论里有一句：北京胡同口/);
  assert.match(joined, /北京胡同口/);
  assert.doesNotMatch(joined, /北京的背景可以轻轻带一下/);
  assert.match(joined, /评论里有一句：你也改不掉一难过就听歌的习惯吗/);
});

test("talk script sanitizer keeps near-match comment paraphrases as comment material", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                opening: "颜人中的《嗜好》放在北京今晚的回家路上。",
                bridges: [
                  "评论里有一句：我最不成熟的行为是心情一好就原谅一切。",
                  "胡同口的夜风开始松，地铁口和路灯都成了背景。"
                ],
                nextTease: "下一首继续接。",
                closing: ""
              })
            }
          }
        ]
      };
    }
  });

  const script = await generateTalkScriptWithLlm({
    track: {
      title: "嗜好",
      artist: "颜人中",
      evidence: ["用户想听有故事的歌"],
      sources: []
    },
    context: {
      query: "北京晚上回家路上，想听点有故事的歌",
      songContext: {
        commentExcerpts: [
          { text: "我最不成熟的行为：心情一好就原谅一切", theme: "听众故事", source: "netease-hot-comment" }
        ]
      },
      broadcastContext: {
        city: "北京",
        localSceneSummary: "胡同口的夜风开始松，地铁口和路灯都成了背景。"
      }
    },
    fallbackScript: {
      opening: "先从这首开始。",
      bridges: ["这里慢一点。"],
      nextTease: "后面继续顺着走。",
      closing: ""
    },
    timeoutMs: 1000
  });

  const joined = script.lines.join("\n");
  assert.match(joined, /评论里有一句：我最不成熟的行为/);
  assert.doesNotMatch(joined, /北京的背景可以轻轻带一下：我最不成熟/);
});

test("talk script sanitizer does not leave empty comment quote labels", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                opening: "《嗜好》和颜人中放在今晚。",
                bridges: [
                  "评论里有一句：“我唯一的嗜好 那便是喜欢你”。",
                  "评论里有人说：北京环路和地铁口，今晚很多人可能都带着这句话回家。"
                ],
                nextTease: "下一首继续接。",
                closing: ""
              })
            }
          }
        ]
      };
    }
  });

  const script = await generateTalkScriptWithLlm({
    track: {
      title: "嗜好",
      artist: "颜人中",
      evidence: [],
      sources: []
    },
    context: {
      query: "北京晚上回家路上，想听点有故事的歌",
      songContext: {
        commentExcerpts: [
          { text: "我唯一的嗜好 那便是喜欢你", theme: "靠近/期待", source: "netease-hot-comment" }
        ]
      },
      broadcastContext: {
        city: "北京",
        localSceneSummary: "北京环路和地铁口，今晚很多人可能都带着这句话回家。"
      }
    },
    fallbackScript: {
      opening: "先从这首开始。",
      bridges: ["这里慢一点。"],
      nextTease: "后面继续顺着走。",
      closing: ""
    },
    timeoutMs: 1000
  });

  const joined = script.lines.join("\n");
  assert.doesNotMatch(joined, /评论里有一句[:：]\s*[。；]/);
  assert.match(joined, /评论里有一句：我唯一的嗜好 那便是喜欢你/);
  assert.doesNotMatch(joined, /评论里有人说：北京环路/);
  assert.doesNotMatch(joined, /北京的背景可以轻轻带一下/);
});

test("talk script sanitizer removes unsupported comment attribution variants", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                  opening: "郑润泽的《于是》放在北京今晚的路上，它下面有人写：嘴上说着翻篇，其实偷偷折了个角。",
                  bridges: [
                    "评论里写着：北京地铁口和环路还亮着，胡同口的风慢慢松下来。",
                    "评论里有人说，去年冬天在北京北站等车，耳机里正好放到这首。"
                  ],
                nextTease: "下一首《嗜好》换一种情绪，不急着往前走。",
                closing: ""
              })
            }
          }
        ]
      };
    }
  });

  const script = await generateTalkScriptWithLlm({
    track: {
      title: "于是",
      artist: "郑润泽",
      evidence: [],
      sources: []
    },
    context: {
      query: "北京晚上回家路上，想听点有故事的歌",
      songContext: {
        commentExcerpts: [
          { text: "去年冬天在北京北站等车，耳机里正好放到这首。", theme: "离开/路上/告别", source: "netease-hot-comment" }
        ]
      },
      broadcastContext: {
        city: "北京",
        localSceneSummary: "北京环路和地铁口还亮着。"
      }
    },
    fallbackScript: {
      opening: "先从这首开始。",
      bridges: ["这里慢一点。"],
      nextTease: "后面继续顺着走。",
      closing: ""
    },
    timeoutMs: 1000
  });

  const joined = script.lines.join("\n");
  assert.doesNotMatch(joined, /它下面有人写|下面有人写|评论里写着/);
  assert.doesNotMatch(joined, /嘴上说着翻篇/);
  assert.doesNotMatch(joined, /继续往回走|风突然换了方向|换一种情绪|不急着往前走/);
  assert.match(joined, /评论里有一句：去年冬天在北京北站等车/);
});

test("talk script sanitizer removes internal repair wording from LLM copy", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                opening: "凤凰传奇的《策马奔腾 桑巴舞曲版》今晚在北京的小雨里开场，别让同一段城市背景抢走音乐。",
                bridges: [
                  "这一次把北京背景收轻一点，先听玲花和曾毅的声音。",
                  "这首先不再重复城市开场，评论里有一句：我猜肯定会有人搜凤凰传奇顺便点了我一下。"
                ],
                nextTease: "下一首继续接。",
                closing: ""
              })
            }
          }
        ]
      };
    }
  });

  const script = await generateTalkScriptWithLlm({
    track: {
      title: "策马奔腾 桑巴舞曲版",
      artist: "凤凰传奇",
      evidence: [],
      sources: []
    },
    context: {
      query: "凤凰传奇 开车 北京 犯困",
      songContext: {
        commentExcerpts: [
          { text: "我猜肯定会有人搜凤凰传奇顺便点了我一下。", theme: "幽默/国民度" }
        ]
      }
    },
    fallbackScript: {
      opening: "先从这首开始。",
      bridges: ["这里慢一点。"],
      nextTease: "后面继续顺着走。",
      closing: ""
    }
  });

  const joined = script.lines.join("\n");
  assert.doesNotMatch(joined, /别让同一段城市背景抢走音乐|这一次把北京背景收轻一点|不再重复城市开场/);
  assert.match(joined, /凤凰传奇|策马奔腾/);
});

test("talk script prompt passes provided broadcast context only", async () => {
  let capturedPayload = null;
  globalThis.fetch = async (_url, options) => {
    capturedPayload = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  opening: "《小半》和陈粒先把今晚的气口放慢一点。",
                  bridges: ["外面有点潮，这段就别急着追完所有消息。"],
                  nextTease: "下一首继续顺着走。",
                  closing: ""
                })
              }
            }
          ]
        };
      }
    };
  };

  await generateTalkScriptWithLlm({
    track: {
      title: "小半",
      artist: "陈粒",
      evidence: ["情绪匹配：安静"],
      sources: []
    },
    context: {
      query: "晚上回家路上",
      broadcastContext: {
        timeCue: "今晚",
        weatherSummary: "外面有点潮，适合慢一点听",
        newsSummary: "今天大家都在聊 AI 应用更新"
      }
    },
    fallbackScript: {
      opening: "先从这首开始。",
      bridges: ["这里慢一点。"],
      nextTease: "后面继续顺着走。",
      closing: ""
    }
  });

  const systemPrompt = capturedPayload.messages[0].content;
  const userPayload = JSON.parse(capturedPayload.messages[1].content);
  assert.deepEqual(userPayload.broadcastContext, {
    timeCue: "今晚",
    weatherSummary: "外面有点潮，适合慢一点听",
    newsSummary: "今天大家都在聊 AI 应用更新"
  });
  assert.match(systemPrompt, /broadcastContext|天气|新闻|不要编造/);
});

test("talk script prompt reduces repeated weather and city scene after the opener", async () => {
  let capturedPayload = null;
  globalThis.fetch = async (_url, options) => {
    capturedPayload = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  opening: "《鲜花》和回春丹从歌曲本身说起。",
                  bridges: ["这首歌换到歌手和评论角度，不再复读天气。"],
                  nextTease: "下一首继续接。",
                  closing: ""
                })
              }
            }
          ]
        };
      }
    };
  };

  await generateTalkScriptWithLlm({
    track: {
      title: "鲜花",
      artist: "回春丹",
      evidence: ["场景匹配：夜晚"],
      sources: []
    },
    context: {
      query: "北京晚上回家路上",
      queueIndex: 2,
      broadcastContext: {
        timeCue: "今晚",
        weatherSummary: "北京现在 35°C，多云，风速约 10km/h",
        city: "北京",
        localSceneSummary: "北京今晚的通勤尾声还挂在地铁和环路上。",
        newsBriefs: [{ text: "科技产品、AI 应用和效率工具总在提醒人快一点" }]
      }
      ,
      contentPack: {
        programSlot: "turn",
        story: {
          commentExcerpts: [
            { text: "去年冬天在北京北站等车，耳机里正好放到这首。", theme: "离开/路上/告别", source: "netease-hot-comment" }
          ]
        },
        editorial: {
          city: "北京",
          localSceneSummary: "北京今晚的通勤尾声还挂在地铁和环路上。",
          newsBriefs: ["科技产品、AI 应用和效率工具总在提醒人快一点"],
          cultureBriefs: ["胡同口、商场外摆和深夜便利店会给歌一个具体位置"]
        }
      }
    },
    fallbackScript: {
      opening: "先从这首开始。",
      bridges: ["这里慢一点。"],
      nextTease: "后面继续顺着走。",
      closing: ""
    },
    timeoutMs: 1000
  });

  const userPayload = JSON.parse(capturedPayload.messages[1].content);
  assert.equal(userPayload.broadcastContext.timeCue, "今晚");
  assert.equal(userPayload.broadcastContext.city, "北京");
  assert.equal(userPayload.broadcastContext.weatherSummary, undefined);
  assert.equal(userPayload.broadcastContext.localSceneSummary, undefined);
  assert.deepEqual(userPayload.broadcastContext.newsBriefs, ["科技产品、AI 应用和效率工具总在提醒人快一点"]);
  assert.equal(userPayload.contentPack.editorial.localSceneSummary, undefined);
  assert.deepEqual(userPayload.contentPack.editorial.newsBriefs, ["科技产品、AI 应用和效率工具总在提醒人快一点"]);
});

test("talk script disables DeepSeek v4 thinking mode for realtime JSON output", async () => {
  const originalModel = process.env.DEEPSEEK_MODEL;
  const originalLlmModel = process.env.LLM_MODEL;
  const originalProvider = process.env.LLM_PROVIDER;
  const originalBase = process.env.DEEPSEEK_API_BASE;
  let capturedPayload = null;
  process.env.DEEPSEEK_MODEL = "deepseek-v4-pro";
  process.env.LLM_MODEL = "";
  process.env.LLM_PROVIDER = "deepseek";
  process.env.DEEPSEEK_API_BASE = "https://api.deepseek.com";
  globalThis.fetch = async (_url, options) => {
    capturedPayload = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  opening: "《于是》和郑润泽先从北京回家路上说起。",
                  bridges: ["这首歌把评论故事和夜晚场景放在一起。"],
                  nextTease: "下一首继续接。",
                  closing: ""
                })
              }
            }
          ]
        };
      }
    };
  };

  try {
    await generateTalkScriptWithLlm({
      track: {
        title: "于是",
        artist: "郑润泽",
        evidence: [],
        sources: []
      },
      context: {
        query: "北京晚上回家路上"
      },
      fallbackScript: {
        opening: "先从这首开始。",
        bridges: ["这里慢一点。"],
        nextTease: "后面继续顺着走。",
        closing: ""
      },
      timeoutMs: 1000
    });
  } finally {
    process.env.DEEPSEEK_MODEL = originalModel;
    process.env.LLM_MODEL = originalLlmModel;
    process.env.LLM_PROVIDER = originalProvider;
    process.env.DEEPSEEK_API_BASE = originalBase;
  }

  assert.deepEqual(capturedPayload.thinking, { type: "disabled" });
});

test("talk script surfaces LLM HTTP errors for production diagnostics", async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    async text() {
      return JSON.stringify({
        error: {
          message: "model does not support thinking parameter"
        }
      });
    }
  });

  const script = await generateTalkScriptWithLlm({
    track: {
      title: "于是",
      artist: "郑润泽",
      evidence: [],
      sources: []
    },
    context: {
      query: "北京晚上回家路上"
    },
    fallbackScript: {
      opening: "先从这首开始。",
      bridges: ["这里慢一点。"],
      nextTease: "后面继续顺着走。",
      closing: ""
    },
    timeoutMs: 1000
  });

  assert.equal(script.rejected, true);
  assert.match(script.reason, /llm_http_400/);
  assert.match(script.reason, /thinking parameter/);
});

test("talk script keeps a song-anchored opening even when city background is similar", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                opening: "《我本将心向明月》和王朝1982放在北京今晚回家路上，地铁口和环路还是背景。",
                bridges: [
                  "这首歌把流行、夜晚和歌手声音放在一起，不再复读前一首。",
                  "评论故事不够时，就把重点放回《我本将心向明月》的歌手和曲风。"
                ],
                nextTease: "下一首继续接。",
                closing: ""
              })
            }
          }
        ]
      };
    }
  });

  const script = await generateTalkScriptWithLlm({
    track: {
      title: "我本将心向明月",
      artist: "王朝1982 / 朱旭BooBoo",
      evidence: [],
      sources: []
    },
    context: {
      query: "北京晚上回家路上",
      recentLines: [
        "《晚安》和颜人中放在北京今晚回家路上，地铁口和环路还是背景。",
        "《知我》和国风堂放在北京今晚回家路上，地铁口和环路还是背景。"
      ]
    },
    fallbackScript: {
      opening: "先从这首开始。",
      bridges: ["这里慢一点。"],
      nextTease: "后面继续顺着走。",
      closing: ""
    },
    timeoutMs: 1000
  });

  assert.equal(script.rejected, undefined);
  assert.match(script.opening, /我本将心向明月|王朝1982/);
});

test("talk script prompt passes structured editorial context for richer radio scripts", async () => {
  let capturedPayload = null;
  globalThis.fetch = async (_url, options) => {
    capturedPayload = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  opening: "《旅行的意义》和陈绮贞放在北京今晚的路上，像把通勤后的气口慢慢打开。",
                  bridges: [
                    "评论里的告别故事不用复述原话，只让它和地铁、环路旁边那点夜风一起留下来。",
                    "城市更新和夜间消费的话题点到为止，真正重要的是你下班后还保留一点自己的时间。"
                  ],
                  nextTease: "下一首继续顺着走。",
                  closing: ""
                })
              }
            }
          ]
        };
      }
    };
  };

  await generateTalkScriptWithLlm({
    track: {
      title: "旅行的意义",
      artist: "陈绮贞",
      scenes: [{ value: "路上", weight: 8 }],
      moods: [{ value: "温柔", weight: 9 }],
      evidence: ["情绪匹配：温柔"],
      sources: []
    },
    context: {
      query: "北京晚上回家路上",
      broadcastContext: {
        timeCue: "今晚",
        city: "北京",
        localSceneSummary: "北京今晚的通勤尾声还挂在地铁和环路上，写字楼的灯慢慢暗下去。",
        newsBriefs: [
          { text: "城市更新和夜间消费的话题这两天还在被讨论", source: "test-editorial" }
        ],
        cultureBriefs: [
          { text: "Livehouse和展览把周中的北京抬亮一点", source: "test-editorial" }
        ],
        editorialAngles: ["通勤后的私人时间"]
      }
    },
    fallbackScript: {
      opening: "先从这首开始。",
      bridges: ["这里慢一点。"],
      nextTease: "后面继续顺着走。",
      closing: ""
    }
  });

  const systemPrompt = capturedPayload.messages[0].content;
  const userPayload = JSON.parse(capturedPayload.messages[1].content);
  assert.equal(userPayload.broadcastContext.city, "北京");
  assert.match(userPayload.broadcastContext.localSceneSummary, /地铁和环路/);
  assert.deepEqual(userPayload.broadcastContext.newsBriefs, ["城市更新和夜间消费的话题这两天还在被讨论"]);
  assert.deepEqual(userPayload.broadcastContext.cultureBriefs, ["Livehouse和展览把周中的北京抬亮一点"]);
  assert.match(systemPrompt, /editorial|资讯|城市|不要编造/);
});

test("talk script prompt passes show talk plan and content pack for city-editorial programs", async () => {
  let capturedPayload = null;
  globalThis.fetch = async (_url, options) => {
    capturedPayload = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  opening: "《旅行的意义》和陈绮贞先接住这期北京回家路上的城市编辑节目。",
                  bridges: [
                    "这首歌的热评故事不用复述原话，只把通勤后的私人时间留下来。",
                    "城市更新和夜间消费的话题点到为止，耳机里的自留地更重要。"
                  ],
                  nextTease: "下一首继续顺着走。",
                  closing: ""
                })
              }
            }
          ]
        };
      }
    };
  };

  await generateTalkScriptWithLlm({
    track: {
      title: "旅行的意义",
      artist: "陈绮贞",
      evidence: ["场景匹配：路上"],
      sources: []
    },
    context: {
      query: "北京晚上回家路上",
      brief: {
        format: "city-editorial",
        city: "北京",
        scene: "回家路上",
        contentTaste: ["stories", "hot-comments", "news", "gossip"]
      },
      showTalkPlan: {
        showThesis: "这是一档关于北京回家路上的城市编辑型私人节目。",
        tone: "城市编辑型，但像朋友在旁边说话",
        voiceProfile: buildTalkVoiceProfile({
          format: "city-editorial",
          city: "北京",
          scene: "回家路上"
        }),
        recurringMotifs: ["通勤后的私人时间", "耳机里的自留地"],
        avoidPhrases: ["今晚这一段"],
        tracks: [{ title: "旅行的意义", slot: "story", talkAngle: "把热评、私人故事和歌曲本身连起来" }]
      },
      contentPack: {
        programSlot: "story",
        selectionReason: "这一首更适合承接热评、故事和私人记忆",
        story: {
          commentExcerpts: [
            {
              text: "在北京西站，一个人拖着箱子听这首歌。",
              theme: "离开/路上/告别",
              source: "netease-hot-comment"
            }
          ],
          hotCommentThemes: ["有人把它听成离开一座城市前的告别"],
          storySummary: "评论里最动人的部分，是很多人借它安放没有说完的告别。"
        },
        artist: {
          name: "陈绮贞",
          brief: "台湾创作女歌手，以清澈嗓音和民谣气质受到关注。",
          facts: ["作品常与旅行、城市和私人记忆有关。"]
        },
        editorial: {
          city: "北京",
          localSceneSummary: "北京今晚的通勤尾声还挂在地铁和环路上。",
          newsBriefs: ["城市更新和夜间消费的话题这两天还在被讨论"],
          cultureBriefs: ["Livehouse和展览把周中的北京抬亮一点"],
          editorialAngles: ["通勤后的私人时间"]
        }
      }
    },
    fallbackScript: {
      opening: "先从这首开始。",
      bridges: ["这里慢一点。"],
      nextTease: "后面继续顺着走。",
      closing: ""
    }
  });

  const systemPrompt = capturedPayload.messages[0].content;
  const userPayload = JSON.parse(capturedPayload.messages[1].content);
  assert.equal(userPayload.brief.format, "city-editorial");
  assert.match(userPayload.showTalkPlan.showThesis, /城市编辑型/);
  assert.equal(userPayload.showTalkPlan.voiceProfile.id, "city-music-editor-friend");
  assert.match(userPayload.showTalkPlan.voiceProfile.styleDirective, /歌名|歌手|北京|地铁口|评论|资讯/);
  assert.equal(userPayload.contentPack.programSlot, "story");
  assert.match(userPayload.contentPack.selectionReason, /热评|故事/);
  assert.equal(userPayload.contentPack.story.commentExcerpts[0].text, "在北京西站，一个人拖着箱子听这首歌。");
  assert.match(userPayload.contentPack.artist.brief, /清澈嗓音|民谣气质/);
  assert.match(systemPrompt, /showTalkPlan|contentPack|节目/);
  assert.match(systemPrompt, /voiceProfile|城市音乐编辑|朋友低声/);
});
