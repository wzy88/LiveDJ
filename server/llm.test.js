import assert from "node:assert/strict";
import test from "node:test";

process.env.LLM_API_KEY = process.env.LLM_API_KEY || "test-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "test-model";

const { generateDialogueReplyWithLlm, generateProgramReplyWithLlm, generateTalkScriptWithLlm } = await import("./llm.js");
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

test("dialogue reply passes local broadcast context for companion chat", async () => {
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
                  intent: "chat",
                  reply: "可以，先不打断这首。北京现在少云、27 度，今天本地这几条我挑跟通勤和演出有关的讲。"
                })
              }
            }
          ]
        };
      }
    };
  };

  const result = await generateDialogueReplyWithLlm({
    message: "听着歌，顺便给我讲讲今天都有哪些本地新闻",
    activeTrack: { title: "无尽幸福", artist: "凌晨一点的莱茵猫" },
    broadcastContext: {
      city: "北京",
      timeCue: "下午",
      weatherSummary: "北京现在 27°C，少云，风速约 8km/h",
      newsBriefs: [{ text: "北京演出消费和商圈夜间活动继续升温。", source: "currents" }],
      cultureBriefs: [{ text: "周中 Livehouse 和小剧场排期比较密。", source: "test-editorial" }],
      editorialAngles: ["北京下午的写字楼和耳机"]
    }
  });

  assert.equal(result.intent, "chat");
  assert.equal(result.source, "llm");
  assert.match(result.reply, /北京|少云|本地/);
  assert.match(capturedPayload.messages[0].content, /本地天气|本地新闻|不要编造/);
  assert.match(capturedPayload.messages[1].content, /broadcastContext/);
  assert.match(capturedPayload.messages[1].content, /北京现在 27°C/);
  assert.match(capturedPayload.messages[1].content, /演出消费/);
});

test("dialogue treats local news companion requests as chat even while music is playing", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "mixed",
                reply: "可以，先不打断这首。《无尽幸福》继续放着；北京这会儿我先挑天气、通勤和演出消费这几条跟你讲。"
              })
            }
          }
        ]
      };
    }
  });

  const result = await generateDialogueReplyWithLlm({
    message: "听着歌，顺便给我讲讲今天都有哪些本地新闻",
    activeTrack: { title: "无尽幸福", artist: "凌晨一点的莱茵猫" },
    queue: [{ title: "无尽幸福", artist: "凌晨一点的莱茵猫" }],
    broadcastContext: {
      city: "北京",
      weatherSummary: "北京现在 27°C，少云",
      newsBriefs: [{ text: "北京演出消费和商圈夜间活动继续升温。", source: "currents" }]
    }
  });

  assert.equal(result.intent, "chat");
  assert.match(result.reply, /本地新闻|北京|演出|天气|通勤/);
  assert.doesNotMatch(result.reply, /排好了|先播/);
});

test("dialogue does not invent local news or promise unqueued songs during companion chat", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "chat",
                reply: "北京今天下午有个大事：东城老胡同要改成文创街区。我顺手给你续一首《遇见》，孙燕姿的。"
              })
            }
          }
        ]
      };
    }
  });

  const result = await generateDialogueReplyWithLlm({
    message: "听着歌，顺便给我讲讲今天都有哪些本地新闻",
    activeTrack: { title: "无尽幸福", artist: "凌晨一点的莱茵猫" },
    queue: [{ title: "无尽幸福", artist: "凌晨一点的莱茵猫" }],
    broadcastContext: {
      city: "北京",
      weatherSummary: "北京现在 27°C，少云",
      newsBriefs: [{ text: "城市更新和夜间消费的话题这两天还在被讨论", source: "test-editorial" }]
    }
  });

  assert.equal(result.intent, "chat");
  assert.equal(result.source, "rules");
  assert.match(result.reply, /实时新闻源|北京现在 27°C|少云/);
  assert.doesNotMatch(result.reply, /东城|文创街区|遇见|孙燕姿|续一首/);
});

test("program reply uses LLM to soften final queue results without hiding failures", async () => {
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
                  reply: "经典老歌这轮我先不硬凑，凤凰传奇的音源没过可播验证；我先把《无尽幸福》接上，后面按北京这条线继续找更稳的。"
                })
              }
            }
          ]
        };
      }
    };
  };

  const result = await generateProgramReplyWithLlm({
    message: "有没有经典老歌 推荐一些、",
    mode: "append",
    fallbackReply: "当前这首我不打断，新的队列会从下一首开始。凤凰传奇这轮没有接上，主要是音源不可播或匹配不可靠。当前正在播《无尽幸福》-凌晨一点的莱茵猫，后面暂时没有稳定可播的新歌。",
    program: {
      brief: { city: "北京", scene: "通勤路上" },
      rejected: [
        { title: "最炫民族风", artist: "凤凰传奇", reason: "音源不可播或匹配不可靠" }
      ],
      visibleQueue: [
        { title: "无尽幸福", artist: "凌晨一点的莱茵猫" }
      ]
    }
  });

  assert.equal(result.source, "llm");
  assert.match(result.reply, /经典老歌|凤凰传奇|音源|无尽幸福/);
  assert.doesNotMatch(result.reply, /匹配不可靠|新的队列会从下一首开始|当前正在播/);
  assert.match(capturedPayload.messages[0].content, /不要像系统日志/);
  assert.match(capturedPayload.messages[1].content, /fallbackReply/);
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

test("talk script respects scene-first strategy without forcing title into opening", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene", "song_reason", "current_track"],
                opening: "灯还亮着，先别急着跟今晚较劲。让声音在旁边铺开，手上的事一件一件来。",
                bridges: [
                  "Rollin' On 适合放在工作时听，不催人，只把桌面上散开的注意力慢慢拢回来。",
                  "它的节奏像一个缓慢转起来的轮子，带一点松弛陪伴，先把最容易开始的那一块往前挪。"
                ],
                nextTease: "下一首会把夜色点亮一点，不是突然热闹，只是让房间里多一点空气。",
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
      title: "Rollin' On",
      artist: "椅子乐团",
      scenes: [{ value: "工作" }],
      moods: [{ value: "松弛" }]
    },
    context: {
      query: "我现在在加班，播点音乐",
      talkBrief: {
        talkStrategy: "scene_first",
        programFunction: "answer_why_this_song_now",
        userKeywords: {
          scene: ["加班", "工作"],
          mood: ["松弛"]
        },
        currentTrack: {
          title: "Rollin' On",
          artist: "椅子乐团",
          selectionReason: "工作时需要松弛陪伴"
        }
      }
    },
    fallbackScript: {
      opening: "先把肩膀松一点。",
      bridges: ["这首歌放在旁边，不催人。"],
      nextTease: "后面换一点夜色。",
      closing: ""
    }
  });

  assert.ok(script);
  assert.equal(script.opening, "灯还亮着，先别急着跟今晚较劲。让声音在旁边铺开，手上的事一件一件来。");
  assert.doesNotMatch(script.opening, /Rollin' On|椅子乐团|《/);
  assert.match(script.lines.join("\n"), /Rollin' On/);
});

test("talk script rejects over-explained scene-first music matching", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene", "current_track", "song_research"],
                opening: "下午骑行到中段，身体已经热开，这首歌把节奏托住。",
                bridges: [
                  "低频和人声放得很近，R&B的律动不催你踏频，只帮你稳住踩踏频率。",
                  "节奏不抢注意力，适合把注意力留给路况和呼吸，让音乐铺一层底色。"
                ],
                nextTease: "下一首节奏会继续托住踏频。",
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
      title: "罗生门（Follow）",
      artist: "梨冻紧",
      scenes: [{ value: "骑行" }],
      moods: [{ value: "明亮" }],
      genres: [{ value: "R&B" }]
    },
    context: {
      query: "我在骑自行车，来点音乐，今天的目标是30Km。",
      talkBrief: {
        talkStrategy: "scene_first",
        programFunction: "companion_scene_progression"
      },
      brief: {
        format: "personal-companion",
        scene: "骑行",
        contentTaste: []
      }
    },
    fallbackScript: {
      opening: "先别急着冲。",
      bridges: ["肩膀松一点。", "注意路口。"],
      nextTease: "后面继续。"
    }
  });

  assert.equal(script.rejected, true);
  assert.match(script.reason, /scene_first_overexplained/);
});

test("talk script rejects generic scene collages built from stock companion imagery", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene"],
                opening: "手机又亮了一下，窗外的风还在吹，桌边那盏灯没有关。",
                bridges: [
                  "先把今天按下暂停，让屏幕暗一点，再给自己一次重启的机会。",
                  "不用急着翻篇，等房间安静下来，呼吸也会慢一点。"
                ],
                nextTease: "后面的声音会继续陪你把夜晚放轻。",
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
      title: "Rollin' On",
      artist: "椅子乐团",
      scenes: [{ value: "工作" }],
      moods: [{ value: "松弛" }]
    },
    context: {
      query: "我现在在加班，播点音乐",
      brief: { format: "personal-companion", scene: "工作学习", contentTaste: [] },
      talkBrief: {
        talkStrategy: "scene_first",
        programFunction: "companion_scene_progression"
      }
    },
    fallbackScript: {
      opening: "先从手边最小的一件事开始。",
      bridges: ["回完最短的那条消息。"],
      nextTease: "后面的歌继续。"
    }
  });

  assert.equal(script.rejected, true);
  assert.match(script.reason, /generic_scene_collage/);
});

test("talk script rejects audible details that are absent from supplied research", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "song_research",
                usedMaterials: ["current_track", "song_research"],
                opening: "这首先留在旁边，不需要把注意力从工作上拿走。",
                bridges: [
                  "前奏里的钢琴很快退到后面，副歌突然加进鼓点，女声还带着明显的气声。",
                  "这些声音让桌前这一段不至于太闷。"
                ],
                nextTease: "下一首会把速度稍微抬高。",
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
      title: "未知歌曲",
      artist: "未知歌手",
      scenes: [{ value: "工作" }],
      moods: [{ value: "松弛" }]
    },
    context: {
      query: "工作时听点不吵的歌",
      brief: { format: "personal-companion", scene: "工作学习", contentTaste: [] },
      talkBrief: {
        talkStrategy: "scene_first",
        programFunction: "companion_scene_progression"
      },
      contentPack: { research: {} }
    },
    fallbackScript: {
      opening: "先把歌放在旁边。",
      bridges: ["不用分神听。"],
      nextTease: "后面继续。"
    }
  });

  assert.equal(script.rejected, true);
  assert.match(script.reason, /unsupported_audible_detail/);
});

test("talk script rejects fictional shared memories with the listener", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene", "current_track"],
                opening: "我记得上次陪你加班时，你也是把手机扣在桌边，等这首歌播完才起身。",
                bridges: [
                  "我们以前总在这个时候听点轻的，今天也照旧。",
                  "先把眼前这一件事处理掉。"
                ],
                nextTease: "下一首继续留在旁边。",
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
      title: "Rollin' On",
      artist: "椅子乐团"
    },
    context: {
      query: "我现在在加班，播点音乐",
      brief: { format: "personal-companion", scene: "工作学习", contentTaste: [] },
      talkBrief: {
        talkStrategy: "scene_first",
        programFunction: "companion_scene_progression"
      }
    },
    fallbackScript: {
      opening: "先把眼前这一件事处理掉。",
      bridges: ["歌放在旁边就好。"],
      nextTease: "后面继续。"
    }
  });

  assert.equal(script.rejected, true);
  assert.match(script.reason, /invented_shared_memory/);
});

test("talk script rejects subtle scene-first song-fit proof lines", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene", "current_track", "song_research"],
                opening: "骑开以后，腿开始适应这个节奏了，先别急着看平均速度。",
                bridges: [
                  "低频铺得很浅，不抢注意力，路口和车流还能放在前面。",
                  "30公里的目标不是靠蛮力，是靠这种节奏把状态托住。"
                ],
                nextTease: "下一首会自然接上。",
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
      scenes: [{ value: "骑行" }],
      moods: [{ value: "明亮" }]
    },
    context: {
      query: "我在骑自行车，来点音乐，今天的目标是30Km。",
      talkBrief: {
        talkStrategy: "scene_first",
        programFunction: "companion_scene_progression"
      },
      brief: {
        format: "personal-companion",
        scene: "骑行",
        contentTaste: []
      }
    },
    fallbackScript: {
      opening: "先别急着冲。",
      bridges: ["肩膀松一点。", "注意路口。"],
      nextTease: "后面继续。"
    }
  });

  assert.equal(script.rejected, true);
  assert.match(script.reason, /proofy_scene_line|too_many_match_terms/);
});

test("talk script rejects cycling scene lines that turn audio texture into fit rationale", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene", "current_track", "song_research", "next_track"],
                opening: "骑到这会儿，腿已经记住了踏板的节奏。",
                bridges: [
                  "这首的明亮音色刚好把这会儿的暗补了一点，不用加速，保持踏频，让轮子一圈一圈走。"
                ],
                nextTease: "下一首会把节奏再放慢半档，适合接下来那段平路。",
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
      title: "旅行的意义",
      artist: "陈绮贞",
      scenes: [{ value: "骑行" }],
      moods: [{ value: "明亮" }]
    },
    context: {
      query: "我在骑自行车，来点音乐，今天的目标是30Km。",
      talkBrief: {
        talkStrategy: "scene_first",
        programFunction: "companion_scene_progression"
      },
      brief: {
        format: "personal-companion",
        scene: "骑行",
        contentTaste: []
      }
    },
    fallbackScript: {
      opening: "先别急着冲。",
      bridges: ["肩膀松一点。", "注意路口。"],
      nextTease: "后面继续。"
    }
  });

  assert.equal(script.rejected, true);
  assert.match(script.reason, /cycling_song_fit_line/);
});

test("talk script rejects cycling next tease that maps song structure to route effort", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene", "current_track", "next_track"],
                opening: "骑到这会儿，身体已经热开了，先看眼前这一段路。",
                bridges: [
                  "别急着算还剩多少，肩膀放松一点，过了下一个路口再说。"
                ],
                nextTease: "这首歌的尾奏像一段缓坡，滑过去之后，下一首声音铺得更满，刚好让你不用再想配速。",
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
      title: "旅行的意义",
      artist: "陈绮贞",
      scenes: [{ value: "骑行" }],
      moods: [{ value: "明亮" }]
    },
    context: {
      query: "我在骑自行车，来点音乐，今天的目标是30Km。",
      talkBrief: {
        talkStrategy: "scene_first",
        programFunction: "companion_scene_progression"
      },
      brief: {
        format: "personal-companion",
        scene: "骑行",
        contentTaste: []
      }
    },
    fallbackScript: {
      opening: "先别急着冲。",
      bridges: ["肩膀松一点。"],
      nextTease: "后面继续。"
    }
  });

  assert.equal(script.rejected, true);
  assert.match(script.reason, /cycling_song_fit_line/);
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
  assert.match(systemPrompt, /写作方法|用户此刻|动作|环境|只轻轻点一下歌曲|差：|好：/);
  assert.match(systemPrompt, /每首歌要承担不同的陪伴功能|起步|进入状态|换一口气|稍微提亮|收住/);
  assert.match(systemPrompt, /companion_scene_progression|陪用户经历这个时刻|不要连续写节奏、低频、踏频、注意力、托住/);
  assert.match(systemPrompt, /场景只定底色|口播要有留白/);
  assert.match(systemPrompt, /身体状态|动作场景|声音感受|播放器界面已经显示歌名和歌手|不用承担报幕职责|不要用歌名歌手当句子的主语/);
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
        research: {
          audibleCues: ["民谣吉他", "清澈人声"],
          backgroundFacts: ["作品常被放在旅行和城市记忆语境里讨论"],
          listenerAngles: ["适合路上和告别场景"],
          talkSeeds: ["吉他和人声先把路上的空间留出来"],
          sources: [{ title: "公开资料摘要", url: "https://example.com/song" }],
          confidence: "search-summary"
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
  assert.match(userPayload.contentPack.research.audibleCues.join(" "), /民谣吉他|清澈人声/);
  assert.match(userPayload.contentPack.research.talkSeeds.join(" "), /吉他和人声/);
  assert.match(systemPrompt, /showTalkPlan|contentPack|节目/);
  assert.match(systemPrompt, /voiceProfile|城市音乐编辑|朋友低声/);
});

test("talk script rejects LLM copy that does not use user need and supplied material", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["current_track"],
                opening: "《最炫民族风》和凤凰传奇先放在这里，熟悉的旋律会让这一段变得热闹一点。",
                bridges: [
                  "这首歌不用解释太多，大家都知道它能把气氛带起来。",
                  "后面继续顺着这个感觉走。"
                ],
                nextTease: "下一首接到《自由飞翔》，节奏会自然往前走。",
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
      title: "最炫民族风",
      artist: "凤凰传奇",
      scenes: [{ value: "开车" }],
      moods: [{ value: "提神" }],
      evidence: ["这次点名想听：凤凰传奇"]
    },
    context: {
      query: "凤凰传奇，开车，北京，犯困。口播里可以带天气新闻娱乐八卦、轻松陪伴、评论热评和创作背景。",
      nextTrack: {
        title: "自由飞翔",
        artist: "凤凰传奇"
      },
      talkBrief: {
        programFunction: "answer_why_this_song_now",
        primaryAngle: "user_scene",
        requiredMaterials: ["user_scene", "song_reason", "current_track", "concrete_material"],
        userKeywords: {
          artists: ["凤凰传奇"],
          city: ["北京"],
          scene: ["开车"],
          mood: ["犯困", "提神"],
          content: ["热评", "新闻"]
        },
        currentTrack: {
          title: "最炫民族风",
          artist: "凤凰传奇",
          selectionReason: "用户点名凤凰传奇，并且需要开车犯困时提神"
        },
        materials: {
          story: "评论里有一句：一听这个前奏，方向盘都想跟着打拍子。",
          cityEditorial: "北京今晚少云，风不大。新闻/资讯：城市夜生活和演出消费还在被讨论。"
        },
        mustMention: ["凤凰传奇", "北京", "开车", "犯困", "最炫民族风"],
        qualityGate: [
          "必须回答为什么此刻放这首歌",
          "必须使用用户诉求、当前歌曲和至少一个具体素材，否则拒稿"
        ]
      },
      songContext: {
        provider: "test",
        commentExcerpts: [{ text: "一听这个前奏，方向盘都想跟着打拍子。", theme: "开车/提神" }],
        storySummary: "评论里常见的是开车提神和国民旋律带来的集体记忆。"
      },
      broadcastContext: {
        city: "北京",
        timeCue: "今晚",
        weatherSummary: "北京今晚少云，风不大。",
        newsBriefs: ["城市夜生活和演出消费还在被讨论。"]
      }
    },
    fallbackScript: {
      opening: "《最炫民族风》先放在这里。",
      bridges: ["先把开车犯困这件事说清楚。"],
      nextTease: "后面接到《自由飞翔》。"
    }
  });

  assert.equal(script.rejected, true);
  assert.match(script.reason, /material_gate/);
});

test("talk script prompt carries the program clock writing role", async () => {
  const originalFetch = globalThis.fetch;
  let userPayload = null;
  globalThis.fetch = async (url, options = {}) => {
    const payload = JSON.parse(options.body || "{}");
    userPayload = JSON.parse(payload.messages?.[1]?.content || "{}");
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene", "current_track"],
                opening: "刚才说先做最小的一件事，现在已经过了几首，手上的节奏可以继续留在这里。",
                bridges: ["不用重新加速，先把眼前这一行处理完。"],
                nextTease: "后面会轻一点换过去，思路不用重新开始。",
                closing: ""
              })
            }
          }
        ]
      })
    };
  };

  try {
    await generateTalkScriptWithLlm({
      track: {
        title: "Rollin' On",
        artist: "椅子乐团",
        scenes: [{ value: "工作" }],
        moods: [{ value: "松弛" }]
      },
      context: {
        query: "我现在在加班，播点音乐",
        queueIndex: 2,
        brief: { format: "personal-companion", scene: "工作学习", contentTaste: [] },
        talkBrief: {
          purpose: "节目中段串联口播",
          programFunction: "companion_scene_progression",
          talkStrategy: "scene_first",
          writingTask: "陪用户经历这个时刻。",
          programClock: {
            role: "callback",
            label: "前文回声",
            playedFields: ["opening"],
            writingInstruction: "承认时间已经过去，呼应前面说过的动作、状态或环境，让听众感到你记得。"
          }
        }
      },
      fallbackScript: {
        opening: "刚才的动作继续做下去。",
        bridges: ["先看眼前这一行。"],
        nextTease: "后面继续。"
      }
    });

    assert.equal(userPayload.talkBrief.programClock.role, "callback");
    assert.equal(userPayload.talkBrief.programClock.label, "前文回声");
    assert.deepEqual(userPayload.talkBrief.programClock.playedFields, ["opening"]);
    assert.match(userPayload.talkBrief.programClock.writingInstruction, /呼应|记得/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
