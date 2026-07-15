import assert from "node:assert/strict";
import test from "node:test";

import { buildRadioProgram, buildTalkScript } from "./radio-program.js";

test("program builds a city-editorial show plan with slots and content packs", async () => {
  const program = await buildRadioProgram({
    query: "北京晚上回家路上，想听点有故事的华语歌，可以带点新闻、热评、八卦感",
    limit: 4,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    songContextProvider: (track) => ({
      provider: "test",
      hotCommentThemes: [`有人把《${track.title}》听成离开一座城市前的告别`],
      storySummary: `评论里最动人的部分，是很多人借《${track.title}》安放没有说完的告别。`
    }),
    refreshSeed: "city-editorial-show-plan-test"
  });

  assert.equal(program.brief.format, "city-editorial");
  assert.match(program.showTalkPlan.showThesis, /北京|城市|节目/);
  assert.ok(program.queue.length >= 3);
  assert.deepEqual(program.queue.slice(0, 3).map((track) => track.programSlot), ["opener", "story", "turn"]);
  for (const track of program.queue.slice(0, 3)) {
    assert.ok(track.programReason, `missing programReason for ${track.title}`);
    assert.equal(track.contentPack.songFacts.title, track.title);
    assert.match(track.contentPack.editorial.city, /北京/);
    assert.match(track.contentPack.selectionReason, /节目|故事|城市|状态|开场|热评|私人/);
  }
  const joined = program.queue.slice(0, 3).flatMap((track) => track.script?.lines || []).join("\n");
  assert.match(joined, /城市编辑|这期节目|节目|地铁口|环路|评论|资讯/);
});

test("program gives the first talk script enough time for LLM to replace rules", async () => {
  const originalFetch = globalThis.fetch;
  let llmCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).includes("/chat/completions")) {
      return originalFetch(url);
    }
    llmCalls += 1;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 3000);
      const signal = options?.signal;
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted by test signal"));
      }, { once: true });
    });
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene", "song_reason", "current_track", "city_editorial"],
                opening: "北京晚高峰还挂在环路上，《旅行的意义》和陈绮贞先把这段回家路放慢一点。",
                bridges: [
                  "评论里有一句关于北京西站和行李箱的短故事，放在这首民谣旁边，比空泛情绪更能落地。",
                  "这期只借一点城市背景：地铁口、路灯和回家路，不把新闻讲成播报。"
                ],
                nextTease: "等这首收住，再接下一首，不硬切。",
                closing: ""
              })
            }
          }
        ]
      })
    };
  };

  try {
    const program = await buildRadioProgram({
      query: "北京晚上回家路上，想听点有故事的民谣，可以带点新闻、热评",
      limit: 2,
      maxWaitMs: 6500,
      scriptBudgetMs: 7000,
      songContextBudgetMs: 0,
      artistContextBudgetMs: 0,
      refreshSeed: "llm-budget-first-script-test"
    });

    assert.ok(llmCalls >= 1);
    assert.equal(program.queue[0].scriptSource, "llm");
    assert.match(program.queue[0].script.opening, /北京晚高峰|旅行的意义|陈绮贞/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("program can give the first three talk scripts enough time for LLM when budget allows", async () => {
  const originalFetch = globalThis.fetch;
  let llmCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).includes("/chat/completions")) {
      return originalFetch(url);
    }
    llmCalls += 1;
    const payload = JSON.parse(options.body || "{}");
    const userPayload = JSON.parse(payload.messages?.[1]?.content || "{}");
    const title = userPayload.track?.title || `第${llmCalls}首`;
    const artist = userPayload.track?.artist || "歌手";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 3000);
      options?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted by test signal"));
      }, { once: true });
    });
    const variants = [
      {
        place: "地铁口",
        story: "北京西站的一条短评论",
        scene: "末班车和行李箱"
      },
      {
        place: "胡同口",
        story: "一条关于晚安的留言",
        scene: "便利店和夜风"
      },
      {
        place: "Livehouse 散场后",
        story: "一条和家人有关的评论",
        scene: "路灯和外卖骑手"
      }
    ];
    const variant = variants[(llmCalls - 1) % variants.length];
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene", "song_reason", "current_track", "city_editorial"],
                opening: `${variant.place}先出现，《${title}》和${artist}从这里切入，模型写稿。`,
                bridges: [
                  `${variant.story}进入《${title}》的口播，回应北京回家路上想听热评故事这件事。`,
                  `${artist}这一段把${variant.scene}和歌手信息接起来。`
                ],
                nextTease: `《${title}》自然接到后面，不报幕。`,
                closing: ""
              })
            }
          }
        ]
      })
    };
  };

  try {
    const program = await buildRadioProgram({
      query: "北京晚上回家路上，想听点有故事的民谣，可以带点新闻、热评",
      limit: 3,
      maxWaitMs: 6500,
      scriptBudgetMs: 14000,
      songContextBudgetMs: 0,
      artistContextBudgetMs: 0,
      refreshSeed: "llm-budget-first-three-scripts-test"
    });

    assert.ok(llmCalls >= 3);
    assert.deepEqual(program.queue.slice(0, 3).map((track) => track.scriptSource), ["llm", "llm", "llm"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("final program rewrites repeated LLM city-background openings across the same show", async () => {
  const originalFetch = globalThis.fetch;
  let llmCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).includes("/chat/completions")) {
      return originalFetch(url);
    }
    llmCalls += 1;
    const payload = JSON.parse(options.body || "{}");
    const userPayload = JSON.parse(payload.messages?.[1]?.content || "{}");
    const title = userPayload.track?.title || `第${llmCalls}首`;
    const artist = userPayload.track?.artist || "歌手";
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene", "song_reason", "current_track", "city_editorial"],
                opening: `《${title}》是${artist}唱的，今晚北京的通勤尾声还挂在地铁和环路上，写字楼的灯慢慢暗下去，这首歌适合放在回家路上那十几分钟。`,
                bridges: [
                  `《${title}》这一段把重点放回歌手和歌曲本身，不再复读前一首。`,
                  `${artist}的声音接到这首歌里，和你这次想听的方向贴近。`
                ],
                nextTease: `等《${title}》收住，再接下一首。`,
                closing: ""
              })
            }
          }
        ]
      })
    };
  };

  try {
    const program = await buildRadioProgram({
      query: "北京晚上回家路上，想听点有故事的民谣，可以带点新闻、热评",
      limit: 3,
      maxWaitMs: 6500,
      scriptBudgetMs: 18000,
      songContextBudgetMs: 0,
      artistContextBudgetMs: 0,
      refreshSeed: "repeated-llm-city-background-test"
    });

    assert.ok(llmCalls >= 3);
    assert.deepEqual(program.queue.slice(0, 3).map((track) => track.scriptSource), ["llm", "llm", "llm"]);
    const joined = program.queue.slice(0, 3).flatMap((track) => track.script?.lines || []).join("\n");
    assert.ok(countOccurrences(joined, "今晚北京的通勤尾声") <= 1, joined);
    assert.ok(countOccurrences(joined, "地铁和环路") <= 1, joined);
    for (const track of program.queue.slice(0, 3)) {
      assert.match(track.script?.opening || "", new RegExp(`${escapeRegExp(track.title)}|${escapeRegExp(String(track.artist).split("/")[0].trim())}`));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("program keeps rule script when LLM copy ignores the supplied scene and materials", async () => {
  const originalFetch = globalThis.fetch;
  let llmCalls = 0;
  globalThis.fetch = async (url) => {
    if (!String(url).includes("/chat/completions")) {
      return originalFetch(url);
    }
    llmCalls += 1;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "song_reason",
                usedMaterials: ["current_track"],
                opening: "《最炫民族风》和凤凰传奇先放在这里，熟悉的旋律会让这一段变得热闹一点。",
                bridges: [
                  "这首歌不用解释太多，大家都知道它能把气氛带起来。",
                  "后面继续顺着这个感觉走。"
                ],
                nextTease: "下一首自然接上。",
                closing: ""
              })
            }
          }
        ]
      })
    };
  };

  try {
    const program = await buildRadioProgram({
      query: "凤凰传奇，开车，北京，犯困。口播里可以带天气新闻娱乐八卦、轻松陪伴、评论热评和创作背景。",
      limit: 2,
      maxWaitMs: 6500,
      scriptBudgetMs: 7000,
      songContextProvider: () => ({
        provider: "test",
        commentExcerpts: [{ text: "一听这个前奏，方向盘都想跟着打拍子。", theme: "开车/提神" }],
        storySummary: "评论里常见的是开车提神和国民旋律带来的集体记忆。"
      }),
      artistContextBudgetMs: 0,
      refreshSeed: "reject-weak-llm-talk-test"
    });

    assert.ok(llmCalls >= 1);
    assert.equal(program.queue[0].scriptSource, "rules");
    assert.equal(program.queue[0].scriptLlmStatus.ok, false);
    assert.match(program.queue[0].scriptLlmStatus.reason, /material_gate/);
    const joined = program.queue[0].script.lines.join("\n");
    assert.match(joined, /凤凰传奇|开车|犯困|提神|评论|北京/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("program honors explicit genre requests when building the playable queue", async () => {
  const program = await buildRadioProgram({
    query: "我想听民谣",
    limit: 4,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    songContextBudgetMs: 0,
    refreshSeed: "program-explicit-folk-test"
  });

  assert.ok(program.queue.length >= 3);
  const debug = program.queue.map((track) => `${track.title} - ${track.artist} | ${(track.genres || []).map((item) => item.value).join("/")}`).join("\n");
  assert.ok(
    program.queue.slice(0, 3).every((track) => (track.genres || []).some((genre) => genre.value === "民谣")),
    `expected playable queue to honor folk request, got:\n${debug}`
  );
});

test("city-editorial program resolves a larger playable pool before planning for variety", async () => {
  const program = await buildRadioProgram({
    query: "北京晚上回家路上，想听点有故事的华语歌，可以带点新闻、热评、八卦感",
    limit: 5,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    songContextBudgetMs: 0,
    refreshSeed: "city-editorial-variety-test"
  });

  const top = program.queue.slice(0, 5);
  const moods = top.map((track) => track.moods?.[0]?.value).filter(Boolean);
  const genres = top.map((track) => track.genres?.[1]?.value || track.genres?.[0]?.value).filter(Boolean);
  const joined = top.flatMap((track) => track.script?.lines || []).join("\n");

  assert.ok(new Set(moods).size >= 2, `expected city-editorial queue to avoid one-note mood, got ${moods.join(", ")}`);
  assert.ok(new Set(genres).size >= 2, `expected city-editorial queue to avoid one-note genre, got ${genres.join(", ")}`);
  assert.doesNotMatch(joined, /耳机里保留耳机里的自留地/);
  assert.doesNotMatch(joined, /；它有可讲的评论\/故事角度；北京语境能自然接上/);
  assert.doesNotMatch(joined, /先按关于/);
  assert.doesNotMatch(joined, /情绪这口气/);
  assert.doesNotMatch(joined, /私人时间|自留地|城市编辑型私人节目/);
});

test("rule talk script anchors the current song instead of only describing mood", () => {
  const script = buildTalkScript({
    id: "song-a",
    title: "一半一半",
    artist: "Top Barry / INDEcompany",
    moods: [{ value: "情绪", weight: 10 }, { value: "温柔", weight: 8 }],
    scenes: [{ value: "通勤", weight: 8 }],
    genres: [{ value: "流行", weight: 9 }, { value: "R&B", weight: 8 }]
  }, {
    query: "下班路上，想听一点华语、松弛、但不要太丧",
    queueIndex: 0
  });

  const joined = [script.opening, ...(script.bridges || [])].join("\n");
  assert.match(joined, /一半一半|Top Barry|INDEcompany|R&B|通勤|情绪|温柔/);
});

test("rule talk script can weave song stories from hot comment context", () => {
  const script = buildTalkScript({
    id: "song-story",
    title: "旅行的意义",
    artist: "陈绮贞",
    moods: [{ value: "明亮", weight: 10 }, { value: "温柔", weight: 8 }],
    scenes: [{ value: "路上", weight: 8 }],
    genres: [{ value: "流行", weight: 9 }, { value: "民谣", weight: 8 }]
  }, {
    query: "下班路上，想听一点华语、松弛、但不要太丧",
    queueIndex: 0,
    songContext: {
      hotCommentThemes: ["有人把它当成离开一座城市前的告别", "也有人说它像一封没寄出的信"],
      storySummary: "评论里最动人的部分，不是旅行本身，而是很多人借这首歌安放没有说完的告别。"
    },
    broadcastContext: {
      timeCue: "今晚",
      weatherSummary: "外面有点潮，适合慢一点听"
    }
  });

  const joined = [script.opening, ...(script.bridges || [])].join("\n");
  assert.match(joined, /旅行的意义|陈绮贞/);
  assert.match(joined, /评论|告别|没寄出的信|故事/);
});

test("rule talk script can quote a short original NetEase comment excerpt when available", () => {
  const script = buildTalkScript({
    id: "song-comment-excerpt",
    title: "旅行的意义",
    artist: "陈绮贞",
    moods: [{ value: "温柔", weight: 10 }],
    scenes: [{ value: "路上", weight: 8 }],
    genres: [{ value: "民谣", weight: 9 }]
  }, {
    query: "北京晚上回家路上，想听点有故事的民谣",
    queueIndex: 0,
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
    broadcastContext: {
      timeCue: "今晚",
      city: "北京",
      weatherSummary: "北京现在 27°C，少云，风不大"
    }
  });

  const joined = [script.opening, ...(script.bridges || [])].join("\n");
  assert.match(joined, /旅行的意义|陈绮贞/);
  assert.match(joined, /评论里有一句|北京西站|拖着箱子/);
  assert.match(joined, /北京|27°C|少云/);
});

test("rule talk script avoids stale template phrases even when LLM is unavailable", () => {
  const script = buildTalkScript({
    id: "song-no-template",
    title: "于是",
    artist: "郑润泽",
    moods: [{ value: "情绪", weight: 10 }],
    scenes: [{ value: "回家路上", weight: 8 }],
    genres: [{ value: "R&B", weight: 9 }]
  }, {
    query: "北京晚上回家路上，想听点有故事的民谣，可以带点新闻、热评",
    queueIndex: 0,
    songContext: {
      provider: "netease-comments",
      commentExcerpts: [{ text: "去年冬天在北京西站等车，耳机里正好放到这首。", theme: "离开/路上/告别" }],
      hotCommentThemes: ["有人把它听成一段关于离开、路上和告别的故事"]
    },
    broadcastContext: {
      timeCue: "今晚",
      city: "北京",
      localSceneSummary: "北京今晚的通勤尾声还挂在地铁和环路上，写字楼的灯慢慢暗下去。",
      newsBriefs: [{ text: "城市更新和夜间消费的话题这两天还在被讨论", source: "test-editorial" }],
      cultureBriefs: [{ text: "Livehouse和展览把周中的北京抬亮一点", source: "test-editorial" }]
    }
  });

  const joined = [script.opening, ...(script.bridges || [])].join("\n");
  assert.match(joined, /于是|郑润泽|北京|评论|北京西站/);
  assert.doesNotMatch(joined, /先别把音量开太大|这首歌的路程感会更清楚|不是催人走快|舒服的拍子|只取和这首歌有关的一点|不把话说满|放在这里，先抓住/);
});

test("rule talk script avoids old fallback copy and repeated weather after opener", () => {
  const script = buildTalkScript({
    id: "fallback-late",
    title: "知我",
    artist: "国风堂 / 哦漏",
    moods: [{ value: "温柔", weight: 10 }],
    scenes: [{ value: "通勤", weight: 8 }],
    genres: [{ value: "流行", weight: 9 }, { value: "摇滚", weight: 7 }]
  }, {
    query: "北京晚上回家路上，想听点有故事的歌",
    queueIndex: 3,
    songContext: {
      provider: "netease-comments",
      commentExcerpts: [{ text: "你的眼神再温柔一点吧，月亮会融化的，我也会。", theme: "靠近/期待" }],
      hotCommentThemes: ["有人把它听成关于靠近和期待的故事"]
    },
    broadcastContext: {
      timeCue: "今晚",
      city: "北京",
      weatherSummary: "北京现在 35°C，多云，风速约 10km/h",
      newsBriefs: [{ text: "科技产品总在提醒人快一点", source: "test" }]
    }
  });

  const joined = [script.opening, ...(script.bridges || []), script.nextTease].filter(Boolean).join("\n");
  assert.match(joined, /知我|国风堂|评论|流行|摇滚|科技产品/);
  assert.doesNotMatch(joined, /适合放在消息还没回完|情绪换一口气|慢慢换一口气|北京现在 35|多云|风速/);
});


test("rule talk script can weave provided broadcast context without inventing it", () => {
  const script = buildTalkScript({
    id: "song-weather",
    title: "小半",
    artist: "陈粒",
    moods: [{ value: "安静", weight: 10 }, { value: "温柔", weight: 8 }],
    scenes: [{ value: "夜晚", weight: 8 }],
    genres: [{ value: "流行", weight: 9 }, { value: "民谣", weight: 8 }]
  }, {
    query: "晚上回家路上",
    queueIndex: 1,
    broadcastContext: {
      timeCue: "今晚",
      weatherSummary: "外面有点潮，适合慢一点听",
      newsSummary: "今天大家都在聊 AI 应用更新"
    }
  });

  const joined = [script.opening, ...(script.bridges || [])].join("\n");
  assert.match(joined, /小半|陈粒/);
  assert.match(joined, /今晚|外面有点潮|AI 应用更新/);
});

test("rule talk script respects morning broadcast context and removes stale evening commute copy", () => {
  const script = buildTalkScript({
    id: "song-morning",
    title: "知我",
    artist: "国风堂 / 哦漏",
    moods: [{ value: "温柔", weight: 10 }],
    scenes: [{ value: "通勤", weight: 8 }],
    genres: [{ value: "流行", weight: 9 }]
  }, {
    query: "下班路上，想听一点华语、松弛、但不要太丧",
    queueIndex: 0,
    broadcastContext: {
      timeCue: "上午",
      city: "北京",
      weatherSummary: "北京现在 25°C，多云",
      localSceneSummary: "北京上午的写字楼和咖啡还在工作日的中段，会议间隙可以给歌一个具体位置。",
      newsBriefs: [{ text: "办公效率和 AI 应用还在被讨论，落到电台里，可以说到会议间隙和耳机里的几分钟", source: "test-editorial" }],
      cultureBriefs: [{ text: "展览和书店也会改变北京白天的路线", source: "test-editorial" }],
      editorialAngles: ["北京上午的写字楼和咖啡", "会议间隙和耳机里的几分钟"]
    }
  });

  const joined = [script.opening, ...(script.bridges || []), script.nextTease].filter(Boolean).join("\n");
  assert.match(joined, /知我|国风堂|上午|会议|咖啡|25°C|多云/);
  assert.doesNotMatch(joined, /今晚|夜里|下班路上|回家路|回家那十几分钟|通勤尾声/);
});

test("rule talk script blends song scene, story, and Beijing editorial briefs into richer copy", () => {
  const script = buildTalkScript({
    id: "song-editorial",
    title: "旅行的意义",
    artist: "陈绮贞",
    moods: [{ value: "温柔", weight: 10 }, { value: "自由", weight: 8 }],
    scenes: [{ value: "旅行散步", weight: 8 }, { value: "夜晚", weight: 7 }],
    genres: [{ value: "民谣", weight: 9 }]
  }, {
    query: "北京晚上回家路上，想听点有故事的歌",
    queueIndex: 0,
    songContext: {
      hotCommentThemes: ["有人把它当成离开一座城市前的告别"],
      storySummary: "评论里最动人的部分，是很多人借这首歌安放没有说完的告别。"
    },
    broadcastContext: {
      timeCue: "今晚",
      city: "北京",
      localSceneSummary: "北京今晚的通勤尾声还挂在地铁和环路上，写字楼的灯慢慢暗下去，胡同口的夜风开始有一点松。",
      newsBriefs: [
        { text: "城市更新和夜间消费的话题这两天还在被讨论，很多人关心工作之后还能不能拥有一点自己的时间", source: "test-editorial" }
      ],
      cultureBriefs: [
        { text: "演出、展览和Livehouse又把周中的北京抬亮一点，年轻人把情绪放进歌里，也放进路上", source: "test-editorial" }
      ],
      editorialAngles: ["通勤后的私人时间", "城市夜生活和耳机里的自留地"]
    }
  });

  const joined = [script.opening, ...(script.bridges || [])].join("\n");
  assert.match(joined, /旅行的意义|陈绮贞/);
  assert.match(joined, /评论|告别|故事/);
  assert.match(joined, /北京|地铁|环路|城市更新|夜间消费|Livehouse|展览/);
  assert.ok((script.bridges || []).length >= 2, joined);
});

test("program query can steer Beijing test context toward evening instead of machine time", async () => {
  const program = await buildRadioProgram({
    query: "北京晚上回家路上，想听点有故事的华语歌",
    limit: 2,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    songContextBudgetMs: 0,
    refreshSeed: "evening-context-test"
  });

  const joined = program.queue.flatMap((track) => track.script?.lines || []).join("\n");
  assert.match(program.broadcastContext.timeCue, /今晚|晚上|夜里|深夜/);
  assert.match(joined, /北京/);
  assert.doesNotMatch(joined, /北京下午/);
  assert.doesNotMatch(joined, /。。/);
});

test("program keeps editorial material in track drafts while the clock selects what is spoken", async () => {
  const program = await buildRadioProgram({
    query: "北京晚上回家路上，想听点有故事的华语歌",
    limit: 3,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    songContextProvider: (track) => ({
      provider: "test",
      storySummary: `评论里最动人的部分，是很多人借《${track.title}》安放没有说完的告别。`
    }),
    refreshSeed: "editorial-bridge-anchor-test"
  });

  const editorialTracks = program.queue.filter((track) =>
    [track.script?.opening, ...(track.script?.bridges || [])].some((line) => /北京|城市更新|夜间消费|Livehouse|展览|地铁口/.test(line))
  );
  assert.ok(editorialTracks.length >= 2, program.queue.map((track) => `${track.title}\n${[track.script?.opening, ...(track.script?.bridges || [])].join("\n")}`).join("\n\n"));
  assert.deepEqual(program.queue.slice(0, 3).map((track) => track.script?.stages?.length), [1, 1, 1]);
});

test("final program keeps every opening anchored after dedupe", async () => {
  const program = await buildRadioProgram({
    query: "下班路上，想听一点华语、松弛、但不要太丧",
    limit: 4,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    songContextBudgetMs: 0
  });

  assert.ok(program.queue.length >= 3);
  for (const track of program.queue.slice(0, 3)) {
    const opening = track.script?.opening || "";
    const leadArtist = String(track.artist || "").split("/")[0].trim();
    assert.match(
      opening,
      new RegExp(`${escapeRegExp(track.title)}|${escapeRegExp(leadArtist)}`),
      `opening should mention current track: ${track.title} - ${opening}`
    );
  }
});

test("final program preserves song-anchored story bridges across similar scripts", async () => {
  const program = await buildRadioProgram({
    query: "下班路上，想听一点华语、松弛、但不要太丧",
    limit: 3,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    songContextProvider: (track) => ({
      provider: "test",
      hotCommentThemes: [`有人把《${track.title}》听成一段私人故事`],
      storySummary: `《${track.title}》下面的评论更像一组私人故事：有人把它听成一段关于靠近和期待的故事。`
    }),
    broadcastContext: {
      timeCue: "今晚",
      weatherSummary: "",
      newsSummary: ""
    }
  });

  const storyTracks = program.queue.filter((track) => track.songContext?.storySummary);
  assert.ok(storyTracks.length >= 2);
  for (const track of storyTracks.slice(0, 2)) {
    const bridges = track.script?.bridges || [];
    assert.ok(
      bridges.some((line) => line.includes(track.title) || line.includes(String(track.artist).split("/")[0].trim())),
      `expected a song-anchored bridge for ${track.title}`
    );
  }
});

test("final program keeps next tease anchored for non-final tracks", async () => {
  const program = await buildRadioProgram({
    query: "下班路上，想听一点华语、松弛、但不要太丧",
    limit: 4,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    songContextBudgetMs: 0
  });

  assert.ok(program.queue.length >= 3);
  program.queue.slice(0, -1).forEach((track, index) => {
    const nextTrack = program.queue[index + 1];
    const nextTease = track.script?.nextTease || "";
    const leadArtist = String(nextTrack.artist || "").split("/")[0].trim();
    assert.match(
      nextTease,
      new RegExp(`${escapeRegExp(nextTrack.title)}|${escapeRegExp(leadArtist)}`),
      `nextTease should mention next track after ${track.title}: ${nextTease}`
    );
  });
});

test("program resolves explicit artist candidates before cached unrelated tracks fill the queue", async () => {
  const program = await buildRadioProgram({
    query: "我说播放李宗盛的音乐",
    limit: 4,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    songContextBudgetMs: 0,
    refreshSeed: "explicit-artist-program-test"
  });

  const topArtists = program.queue.slice(0, 3).map((track) => track.artist).join("\n");
  assert.match(topArtists, /李宗盛/, `expected 李宗盛 in playable program queue, got:\n${topArtists}`);
});

test("final program varies story framing instead of repeating the same template", async () => {
  const program = await buildRadioProgram({
    query: "下班路上，想听一点华语、松弛、但不要太丧",
    limit: 5,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    songContextProvider: (track) => ({
      provider: "test",
      hotCommentThemes: [`有人把《${track.title}》听成一段私人故事`],
      storySummary: `《${track.title}》下面的评论更像一组私人故事：有人把它听成一段关于靠近和期待的故事。`
    }),
    broadcastContext: {
      timeCue: "今晚",
      weatherSummary: "",
      newsSummary: ""
    }
  });

  const lines = program.queue.flatMap((track) => track.script?.lines || []);
  const repeatedFrameCount = lines.filter((line) => /还有一层评论里的余温|放在今晚里听，会更像一段有温度的过场/.test(line)).length;
  assert.ok(repeatedFrameCount <= 1, `story framing repeated too much:\n${lines.join("\n")}`);
});

test("rule talk script does not create malformed song cue punctuation", () => {
  const script = buildTalkScript({
    id: "song-cue-punctuation",
    title: "光辉岁月",
    artist: "Beyond",
    moods: [{ value: "温柔", weight: 10 }],
    scenes: [{ value: "夜晚", weight: 8 }],
    genres: [{ value: "粤语", weight: 9 }, { value: "流行", weight: 8 }]
  }, {
    query: "下班路上",
    queueIndex: 1
  });

  const joined = [script.opening, ...(script.bridges || [])].join("\n");
  assert.doesNotMatch(joined, /，里的|，的好处/);
});

test("final program does not create awkward next-tease replacement grammar", async () => {
  const program = await buildRadioProgram({
    query: "下班路上，想听一点华语、松弛、但不要太丧",
    limit: 6,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    refreshSeed: "next-grammar-test"
  });

  const joined = program.queue.flatMap((track) => track.script?.lines || []).join("\n");
  assert.doesNotMatch(joined, /下一首《[^》]+》它不是/);
  assert.doesNotMatch(joined, /情绪会从|慢慢换一口气|重点不是煽情|能跟上的拍子/);
  assert.doesNotMatch(joined, /刚才这点情绪|刚才这段状态/);
  assert.doesNotMatch(joined, /从刚才这点情绪换到情绪|从([^，。；]+)换到\1/);
});

test("final program avoids repeated stock phrases across the same show", async () => {
  const program = await buildRadioProgram({
    query: "下班路上，想听一点华语、松弛、但不要太丧",
    limit: 6,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    refreshSeed: "stock-phrase-test"
  });

  const joined = program.queue.flatMap((track) => track.script?.lines || []).join("\n");
  const stockPhrases = [
    "生活不会因为一首歌的时间就散架",
    "不负责劝人，只负责别太用力地陪着",
    "不是硬转场",
    "不是为了换热闹",
    "让耳朵换一条路走",
    "把频道稍微拨暗一点",
    "外面，还有一层听众自己的生活",
    "刚才这一分钟",
    "最好的地方是没有把情绪推得太满",
    "换一束侧光进来",
    "如果刚才像把白天放慢",
    "等这首再往后走一点",
    "别一上来就太满"
  ];
  for (const phrase of stockPhrases) {
    const count = countOccurrences(joined, phrase);
    assert.ok(count <= 1, `phrase repeated ${count} times: ${phrase}\n${joined}`);
  }
});

test("rule talk script avoids abstract radio copy for familiar karaoke tracks", () => {
  const script = buildTalkScript({
    id: "beyond-hktk",
    title: "海阔天空",
    artist: "Beyond",
    moods: [{ value: "温柔", weight: 10 }, { value: "松弛", weight: 8 }],
    scenes: [{ value: "下班", weight: 8 }, { value: "路上", weight: 7 }],
    genres: [{ value: "粤语", weight: 10 }, { value: "流行", weight: 9 }]
  }, {
    query: "今晚下班路上，想听一点华语、松弛、但不要太丧",
    queueIndex: 1
  });

  const joined = [script.opening, ...(script.bridges || []), script.nextTease].filter(Boolean).join("\n");
  assert.match(script.opening, /^《海阔天空》|^Beyond|^今晚|^下班|^路上|^有人说|^评论|^网络上/);
  assert.doesNotMatch(script.opening, /^这里|^走到这儿|^这一首|^往后一点|^把频道|^让耳朵|^换一个/);
  assert.match(joined, /海阔天空|Beyond|粤语|流行|下班|路上/);
  assert.doesNotMatch(joined, /情绪路线|慢慢听|很稳|气口|主线|接住|往下走|继续往前|舒服的位置|不刺眼的灯|侧光|频道|把声音放到|负责把|不急着安慰人|不负责劝人|像一盏/);
  assert.doesNotMatch(joined, /音乐不用负责解决问题|温柔不是糖|锋利的地方|不用马上变好|讲大道理|回到现实里|很珍贵/);
  assert.doesNotMatch(joined, /由Beyond唱出来的粤语和流行留出来的空间/);
});

test("office-energy talk script writes listenable copy instead of explaining recommendation rules", () => {
  const script = buildTalkScript({
    id: "kara-ok",
    title: "卡拉永远OK",
    artist: "谭咏麟",
    programSlot: "rhythm-lift",
    moods: [{ value: "明亮", weight: 10 }, { value: "提神", weight: 8 }],
    scenes: [{ value: "学习工作", weight: 10 }, { value: "日常陪伴", weight: 7 }],
    genres: [{ value: "粤语", weight: 10 }, { value: "流行", weight: 9 }]
  }, {
    query: "我想听经典老歌，给我推荐一些，最好节奏感强一点，不然下午办公会犯困。",
    brief: {
      scene: "工作学习",
      mood: ["明亮", "提神", "节奏感"],
      musicTaste: {
        eras: ["经典老歌"],
        energy: ["节奏感强"]
      },
      useCase: ["办公防困"]
    },
    queueIndex: 1
  });

  const joined = [script.opening, ...(script.bridges || [])].join("\n");
  assert.match(joined, /键盘|表格|文档|消息|眼皮|手指|副歌|鼓点|拍子/);
  assert.doesNotMatch(joined, /这轮选歌|三个条件|优势是|入口熟|适合续航|放在这一段收一下|经典老歌的熟悉度|用户这次|节目/);
});

test("office-energy program varies each track by a distinct listening angle", async () => {
  const program = await buildRadioProgram({
    query: "我想听经典老歌，给我推荐一些，最好节奏感强一点，不然下午办公会犯困。",
    limit: 5,
    maxWaitMs: 0,
    scriptBudgetMs: 0,
    songContextBudgetMs: 0,
    artistContextBudgetMs: 0,
    refreshSeed: "office-energy-varied-angle-test"
  });

  const linesByTrack = program.queue.slice(0, 5).map((track) => (track.script?.lines || []).join("\n"));
  assert.equal(linesByTrack.length, 5);
  assert.deepEqual(program.queue.slice(0, 5).map((track) => track.programClock?.role), [
    "block_open",
    "presence_touch",
    "callback",
    "trust_window",
    "mid_anchor"
  ]);
  assert.equal(linesByTrack[3], "");
  const joined = linesByTrack.join("\n");
  for (const angle of ["眼皮|第一下|叫醒", "鼓点|律动|脉冲", "副歌|前奏|不用重新认识", "音量|半格|收住|不被歌推着跑"]) {
    assert.match(joined, new RegExp(angle), `missing angle: ${angle}\n${joined}`);
  }
  const trustWindowDraft = [program.queue[3].script?.opening, ...(program.queue[3].script?.bridges || [])].join("\n");
  assert.match(trustWindowDraft, /后台|背景|工作流|手头/);
  for (const phrase of ["表格", "键盘", "文档", "消息", "熟旋律", "省脑子", "拍子"]) {
    const count = countOccurrences(joined, phrase);
    assert.ok(count <= 3, `office-energy phrase repeated ${count} times: ${phrase}\n${joined}`);
  }
});

test("office-energy openings lead with scene instead of song announcement", async () => {
  const program = await buildRadioProgram({
    query: "我想听经典老歌，给我推荐一些，最好节奏感强一点，不然下午办公会犯困。",
    limit: 5,
    maxWaitMs: 0,
    scriptBudgetMs: 0,
    songContextBudgetMs: 0,
    artistContextBudgetMs: 0,
    refreshSeed: "office-energy-scene-first-opening-test"
  });

  for (const track of program.queue.slice(0, 5)) {
    const opening = track.script?.opening || track.script?.lines?.[0] || "";
    const leadArtist = (track.artist || "").split("/")[0].trim();
    assert.doesNotMatch(
      opening,
      new RegExp(`《|${escapeRegExp(track.title)}|${escapeRegExp(leadArtist)}`),
      `opening starts like a song announcement for ${track.title}: ${opening}`
    );
    const talkLines = (track.script?.lines || []).join("\n");
    assert.equal(countOccurrences(talkLines, leadArtist), 0, `artist name should not be a crutch in talk copy: ${talkLines}`);
    assert.ok(countOccurrences(talkLines, track.title) <= 1, `song title repeated as a crutch in talk copy: ${talkLines}`);
  }
});

test("plain overtime companion program does not inject city editorial material", async () => {
  const program = await buildRadioProgram({
    query: "我现在在加班，播点音乐",
    limit: 3,
    maxWaitMs: 0,
    scriptBudgetMs: 0,
    songContextBudgetMs: 0,
    artistContextBudgetMs: 0,
    refreshSeed: "plain-overtime-no-city-editorial-test"
  });

  assert.equal(program.brief.scene, "工作学习");
  assert.equal(program.brief.format, "personal-companion");
  assert.equal(program.broadcastContext.city, undefined);
  assert.equal(program.broadcastContext.localSceneSummary, undefined);
  assert.equal(program.broadcastContext.newsBriefs, undefined);
  assert.equal(program.broadcastContext.cultureBriefs, undefined);
  const joined = program.queue.flatMap((track) => track.script?.lines || []).join("\n");
  assert.doesNotMatch(joined, /北京|回家路上|地铁口|环路|新闻|资讯|夜间消费|Livehouse|展览|胡同口/);
  assert.doesNotMatch(joined, /学习工作|不靠空话撑场|按当前状态排歌|用户这次|这期节目/);
  assert.doesNotMatch(joined, /。，待会儿|再接下一首可播的歌/);
  for (const track of program.queue.slice(0, 3)) {
    assert.doesNotMatch(track.script?.opening || "", new RegExp(`《|${escapeRegExp(track.title)}`));
  }
});

test("cycling goal companion program uses riding language instead of work fallback", async () => {
  const program = await buildRadioProgram({
    query: "我在骑自行车，来点音乐，今天的目标是30Km。",
    limit: 4,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    songContextBudgetMs: 0,
    artistContextBudgetMs: 0,
    trackResearchProvider: async () => ({
      provider: "test",
      audibleCues: ["节奏清楚", "明亮音色"],
      listenerAngles: ["适合骑行路上稳定踏频"],
      talkSeeds: ["节奏可以贴着踏频走，别抢路上的注意力"],
      backgroundFacts: [],
      sources: [],
      confidence: "test"
    }),
    refreshSeed: "cycling-goal-companion-test"
  });

  assert.equal(program.brief.scene, "骑行");
  const joined = program.queue.flatMap((track) => track.script?.lines || []).join("\n");
  assert.match(joined, /30|公里|骑|轮子|踏频|踏板|路上|呼吸|风/);
  assert.doesNotMatch(joined, /加班|工作|表格|文档|屏幕|桌面|窗口|手边|手上的|事情|消息|评论里/);
});

test("cycling goal companion program does not over-explain song-scene matching", async () => {
  const program = await buildRadioProgram({
    query: "我在骑自行车，来点音乐，今天的目标是30Km。",
    limit: 5,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    songContextBudgetMs: 0,
    artistContextBudgetMs: 0,
    trackResearchProvider: async () => ({
      provider: "test",
      audibleCues: ["节奏清楚", "低频"],
      listenerAngles: ["适合骑行路上稳定踏频"],
      talkSeeds: ["节奏可以贴着踏频走，别抢路上的注意力"],
      backgroundFacts: [],
      sources: [],
      confidence: "test"
    }),
    refreshSeed: "cycling-less-proofy-talk-test"
  });

  const joined = program.queue.flatMap((track) => track.script?.lines || []).join("\n");
  assert.ok(countOccurrences(joined, "节奏") <= 5, joined);
  assert.ok(countOccurrences(joined, "踏频") <= 3, joined);
  assert.ok(countOccurrences(joined, "托住") <= 2, joined);
  assert.ok(countOccurrences(joined, "低频") <= 1, joined);
  assert.match(joined, /眼睛看远|肩膀|喝口水|路口|车流|安全|心率|腿/);
  const nextLines = program.queue
    .slice(0, -1)
    .map((track) => (track.script?.stages || []).find((stage) => stage.type === "next")?.text)
    .filter(Boolean);
  assert.equal(new Set(nextLines).size, nextLines.length, nextLines.join("\n"));
});

test("scene-first companion prompt does not force comment stories when user only gives an activity", async () => {
  const originalFetch = globalThis.fetch;
  let capturedPayload = null;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).includes("/chat/completions")) return originalFetch(url, options);
    const payload = JSON.parse(options.body || "{}");
    capturedPayload = JSON.parse(payload.messages?.[1]?.content || "{}");
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene", "current_track", "song_research", "next_track"],
                opening: "风从耳边过去，这首歌先把踏频托住。",
                bridges: ["节奏清楚，适合贴着轮子往前走。"],
                nextTease: "下一首继续把速度接住。",
                closing: ""
              })
            }
          }
        ]
      })
    };
  };

  try {
    await buildRadioProgram({
      query: "我在骑自行车，来点音乐，今天的目标是30Km。",
      limit: 2,
      maxWaitMs: 6500,
      scriptBudgetMs: 4000,
      songContextProvider: () => ({
        provider: "test",
        commentExcerpts: [{ text: "不够厉害不要爱我", theme: "歌词式表达" }],
        storySummary: "评论里有人提到不够厉害不要爱我。"
      }),
      artistContextBudgetMs: 0,
      trackResearchProvider: async () => ({
        provider: "test",
        audibleCues: ["节奏清楚"],
        listenerAngles: ["适合骑行路上稳定踏频"],
        talkSeeds: ["节奏可以贴着踏频走"],
        backgroundFacts: [],
        sources: [],
        confidence: "test"
      }),
      refreshSeed: "scene-first-no-forced-story-test"
    });

    assert.ok(capturedPayload);
    assert.equal(capturedPayload.talkBrief?.talkStrategy, "scene_first");
    assert.doesNotMatch(JSON.stringify(capturedPayload), /不够厉害不要爱我|评论里有人提到|commentExcerpts|storySummary/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scene-first LLM scripts do not repeat the raw user scene keyword across tracks", async () => {
  const originalFetch = globalThis.fetch;
  let llmCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).includes("/chat/completions")) return originalFetch(url, options);
    llmCalls += 1;
    const payload = JSON.parse(options.body || "{}");
    const userPayload = JSON.parse(payload.messages?.[1]?.content || "{}");
    const title = userPayload.track?.title || "这首歌";
    const artist = String(userPayload.track?.artist || "歌手").split("/")[0].trim();
    const nextTitle = userPayload.nextTrack?.title || "下一首";
    const variants = [
      {
        object: "屏幕上的字开始自己排队了",
        bridgeA: "别一下子把所有窗口摊开，先处理眼前这一件",
        bridgeB: "桌面上的东西慢慢往中间收"
      },
      {
        object: "屏幕上的字开始自己排队了",
        bridgeA: "先把消息和文档分开，回完最短的那条",
        bridgeB: "房间里留一点空隙，思路会顺回来"
      },
      {
        object: "屏幕上的字开始自己排队了",
        bridgeA: "先从最小的一件事开始，别急着同时处理全部",
        bridgeB: "桌面可以慢慢收，人不用被每个窗口一起拉扯"
      }
    ];
    const variant = variants[(llmCalls - 1) % variants.length];
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene", "current_track", "song_research", "next_track"],
                opening: `上午加班，${variant.object}。《${title}》和${artist}先放在旁边。`,
                bridges: [
                  `加班的时候${variant.bridgeA}。`,
                  `加班到这里，${variant.bridgeB}。`
                ],
                nextTease: `后面接到《${nextTitle}》时，先别让思路断掉。`,
                closing: ""
              })
            }
          }
        ]
      })
    };
  };

  try {
    const program = await buildRadioProgram({
      query: "我现在在加班，播点音乐",
      limit: 3,
      maxWaitMs: 6500,
      scriptBudgetMs: 12000,
      songContextBudgetMs: 0,
      artistContextBudgetMs: 0,
      trackResearchProvider: async () => ({
        provider: "test",
        audibleCues: ["低频"],
        listenerAngles: ["桌前工作时不抢注意力"],
        talkSeeds: ["低频可以放在旁边，把状态托住。"],
        backgroundFacts: [],
        sources: [],
        confidence: "test"
      }),
      refreshSeed: "scene-keyword-dedupe-test"
    });

    const joined = program.queue.flatMap((track) => track.script?.lines || []).join("\n");
    assert.ok(program.queue.slice(0, 2).filter((track) => track.scriptSource === "llm").length >= 2);
    assert.ok(countOccurrences(joined, "加班") <= 1, joined);
    assert.ok(countOccurrences(joined, "屏幕上的字开始自己排队了") <= 1, joined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scene-first LLM scripts strip invented city and wrong time cues", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).includes("/chat/completions")) return originalFetch(url, options);
    const payload = JSON.parse(options.body || "{}");
    const userPayload = JSON.parse(payload.messages?.[1]?.content || "{}");
    const title = userPayload.track?.title || "这首歌";
    const artist = String(userPayload.track?.artist || "歌手").split("/")[0].trim();
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene", "current_track", "song_research", "next_track"],
                opening: `凌晨的屏幕前，${title}和${artist}先放在旁边。`,
                bridges: [
                  "放回北京今晚的背景里，房间里先留一点空隙。",
                  "加班到这里，桌面上的事可以慢慢收。"
                ],
                nextTease: "下一首海屿你，会自然接上。",
                closing: ""
              })
            }
          }
        ]
      })
    };
  };

  try {
    const program = await buildRadioProgram({
      query: "我现在在加班，播点音乐",
      limit: 2,
      maxWaitMs: 6500,
      scriptBudgetMs: 8000,
      songContextBudgetMs: 0,
      artistContextBudgetMs: 0,
      trackResearchProvider: async () => ({
        provider: "test",
        audibleCues: ["低频"],
        listenerAngles: ["桌前工作时不抢注意力"],
        talkSeeds: ["低频可以放在旁边，把状态托住。"],
        backgroundFacts: [],
        sources: [],
        confidence: "test"
      }),
      refreshSeed: "scene-invented-city-time-test"
    });

    const joined = program.queue.flatMap((track) => track.script?.lines || []).join("\n");
    assert.equal(program.queue[0].scriptSource, "llm");
    assert.doesNotMatch(joined, /北京|今晚|凌晨|。，待会儿/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("plain cycling LLM scripts strip invented comments and progress claims", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).includes("/chat/completions")) return originalFetch(url, options);
    const payload = JSON.parse(options.body || "{}");
    const userPayload = JSON.parse(payload.messages?.[1]?.content || "{}");
    const title = userPayload.track?.title || "这首歌";
    const artist = String(userPayload.track?.artist || "歌手").split("/")[0].trim();
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene", "current_track", "song_research", "next_track"],
                opening: `夜骑到后半程，${title}和${artist}先放在旁边。`,
                bridges: [
                  "评论里有人说这首像夜骑时耳边的风。",
                  "骑了快一半，腿开始有记忆感。"
                ],
                nextTease: "下一首继续接上。",
                closing: ""
              })
            }
          }
        ]
      })
    };
  };

  try {
    const program = await buildRadioProgram({
      query: "我在骑自行车，来点音乐，今天的目标是30Km。",
      limit: 2,
      maxWaitMs: 6500,
      scriptBudgetMs: 6000,
      songContextBudgetMs: 0,
      artistContextBudgetMs: 0,
      trackResearchProvider: async () => ({
        provider: "test",
        audibleCues: ["节奏清楚"],
        listenerAngles: ["适合骑行路上稳定踏频"],
        talkSeeds: ["节奏可以贴着踏频走"],
        backgroundFacts: [],
        sources: [],
        confidence: "test"
      }),
      refreshSeed: "cycling-strip-invented-comments-test"
    });

    const joined = program.queue.flatMap((track) => track.script?.lines || []).join("\n");
    assert.equal(program.queue[0].scriptSource, "llm");
    assert.doesNotMatch(joined, /评论里|夜骑|后半程|骑了快一半|骑到后半程/);
    assert.match(joined, /骑|踏频|呼吸|30|公里|路/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("program enriches tracks with searchable song research material", async () => {
  const program = await buildRadioProgram({
    query: "我现在在加班，播点音乐",
    limit: 3,
    maxWaitMs: 0,
    scriptBudgetMs: 0,
    songContextBudgetMs: 0,
    artistContextBudgetMs: 0,
    trackResearchBudgetMs: 2000,
    trackResearchProvider: async (track) => ({
      provider: "search-summary",
      audibleCues: ["R&B低频", "人声贴近"],
      listenerAngles: [`${track.title}适合桌前工作时不抢注意力`],
      backgroundFacts: ["公开讨论里常把它放在夜里独处和轻松陪伴语境里"],
      talkSeeds: ["低频和人声可以放近一点，适合在旁边铺开"],
      sources: [{ title: `${track.title} 搜索摘要`, url: "https://example.com/search" }],
      confidence: "search-summary"
    }),
    refreshSeed: "track-research-runtime-material-test"
  });

  assert.ok(program.queue.length >= 2);
  for (const track of program.queue.slice(0, 2)) {
    assert.match(track.contentPack?.research?.audibleCues?.join(" "), /R&B低频|人声贴近/);
    assert.match(track.contentPack?.research?.talkSeeds?.join(" "), /低频和人声/);
    assert.match(track.talkBrief?.materials?.songResearch || "", /听感|口播种子|R&B低频|低频和人声/);
  }
  const joined = program.queue.slice(0, 2).flatMap((track) => track.script?.lines || []).join("\n");
  assert.match(joined, /低频|人声|节奏不急|放近一点/);
});

test("final program avoids malformed story framing and repeated slot cues", async () => {
  const program = await buildRadioProgram({
    query: "下班路上，想听一点华语、松弛、但不要太丧",
    limit: 6,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    songContextProvider: (track) => ({
      provider: "test",
      hotCommentThemes: [`有人把《${track.title}》听成一段私人故事`],
      storySummary: `《${track.title}》下面的评论更像一组私人故事：有人把它听成一段关于靠近和期待的故事。`
    }),
    broadcastContext: {
      timeCue: "今晚",
      weatherSummary: "",
      newsSummary: ""
    }
  });

  const joined = program.queue.flatMap((track) => track.script?.lines || []).join("\n");
  assert.doesNotMatch(joined, /声音里外面/);
  assert.ok(countOccurrences(joined, "走到这儿，换一个角度") <= 1, joined);
});

test("final program schedules a six-track companionship clock instead of four talks per song", async () => {
  const program = await buildRadioProgram({
    query: "我现在在加班，播点音乐",
    limit: 6,
    maxWaitMs: 6500,
    scriptBudgetMs: 0,
    songContextBudgetMs: 0,
    artistContextBudgetMs: 0,
    trackResearchBudgetMs: 0,
    refreshSeed: "program-clock-stage-pattern-test"
  });

  assert.ok(program.queue.length >= 6);
  assert.deepEqual(program.queue.slice(0, 6).map((track) => track.programClock?.role), [
    "block_open",
    "presence_touch",
    "callback",
    "trust_window",
    "mid_anchor",
    "soft_handoff"
  ]);
  assert.deepEqual(program.queue.slice(0, 6).map((track) => track.script?.stages?.length), [1, 1, 1, 0, 1, 2]);
});

test("program clock trust window skips its LLM script call", async () => {
  const originalFetch = globalThis.fetch;
  const llmQueueIndexes = [];
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).includes("/chat/completions")) return originalFetch(url, options);
    const payload = JSON.parse(options.body || "{}");
    const userPayload = JSON.parse(payload.messages?.[1]?.content || "{}");
    llmQueueIndexes.push(userPayload.queueIndex);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                angle: "user_scene",
                usedMaterials: ["user_scene", "current_track"],
                opening: `已经过了 ${userPayload.queueIndex + 1} 首，先把眼前这一小件事做完。`,
                bridges: ["不用重新加速，手上的动作继续就好。"],
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
    const program = await buildRadioProgram({
      query: "我现在在加班，播点音乐",
      limit: 6,
      maxWaitMs: 6500,
      scriptBudgetMs: 28000,
      songContextBudgetMs: 0,
      artistContextBudgetMs: 0,
      trackResearchBudgetMs: 0,
      refreshSeed: "program-clock-silent-llm-test"
    });

    assert.ok(program.queue.length >= 6);
    assert.deepEqual(llmQueueIndexes, [0, 1, 2, 4, 5]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function countOccurrences(text, phrase) {
  return String(text).split(phrase).length - 1;
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
