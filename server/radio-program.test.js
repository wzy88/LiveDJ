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
                opening: `${variant.place}先出现，《${title}》和${artist}从这里切入，模型写稿。`,
                bridges: [
                  `${variant.story}进入《${title}》的口播，不再用本地模板。`,
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

test("final program keeps editorial bridges for multiple tracks by anchoring them to songs", async () => {
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
    (track.script?.lines || []).some((line) => /北京|城市更新|夜间消费|Livehouse|展览|地铁口/.test(line))
  );
  assert.ok(editorialTracks.length >= 2, program.queue.map((track) => `${track.title}\n${track.script?.lines?.join("\n")}`).join("\n\n"));
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

function countOccurrences(text, phrase) {
  return String(text).split(phrase).length - 1;
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
