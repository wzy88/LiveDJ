import { loadProfile, recommend } from "./recommender.js";
import { resolvePlayableTrack } from "./music.js";
import { getCleanPlayableRecord } from "./playable-index.js";
import { generateTalkScriptWithLlm } from "./llm.js";

export async function buildRadioProgram({ query = "", limit = 6, maxWaitMs = 0 } = {}) {
  const profile = loadProfile();
  const raw = recommend({ query, limit: Math.max(24, limit * 6) });
  const queue = [];
  const rejected = [];
  const candidates = (raw.recommendations || []).slice(0, Math.max(24, limit * 5));
  const usedIds = new Set();
  for (const track of candidates) {
    const cached = getCleanPlayableRecord(track.id, track);
    if (!cached?.streamUrl) continue;
    pushPlayable(queue, track, cached, { query, profile, anchors: raw.anchors || [] });
    usedIds.add(track.id);
    if (queue.length >= limit) break;
  }

  if (queue.length < limit) {
    const remaining = candidates.filter((track) => !usedIds.has(track.id));
    const startedAt = Date.now();
    const budgetMs = maxWaitMs || (queue.length ? 1900 : 3200);
    for (let index = 0; index < remaining.length && queue.length < limit; index += 4) {
      const timeLeft = budgetMs - (Date.now() - startedAt);
      if (timeLeft < 500) break;
      const batch = remaining.slice(index, index + 4);
      const results = await Promise.allSettled(batch.map((track) => resolveWithTimeout(track, Math.min(1800, timeLeft))));
      results.forEach((result, batchIndex) => {
        const track = batch[batchIndex];
        if (queue.length >= limit) return;
        if (result.status !== "fulfilled" || !result.value) {
          rejected.push({ id: track.id, title: track.title, artist: track.artist, reason: "音源不可播或匹配不可靠" });
          return;
        }
        pushPlayable(queue, track, result.value, { query, profile, anchors: raw.anchors || [] });
      });
    }
  }

  for (const track of candidates) {
    if (queue.some((item) => item.id === track.id) || rejected.some((item) => item.id === track.id)) continue;
    rejected.push({ id: track.id, title: track.title, artist: track.artist, reason: "本轮时间内未完成解析" });
  }

  await enrichQueueScripts(queue, { query, profile, anchors: raw.anchors || [] });
  attachProgramFlow(queue, { query, profile, anchors: raw.anchors || [] });

  return {
    query,
    rawCount: (raw.recommendations || []).length,
    rejected,
    queue,
    profile: raw.profile,
    anchors: raw.anchors
  };
}

function pushPlayable(queue, track, resolvedTrack, context) {
  const queueIndex = queue.length;
  const displayTrack = {
    ...track,
    title: resolvedTrack.title || track.title,
    artist: resolvedTrack.artist || track.artist,
    durationSec: resolvedTrack.durationSec || track.durationSec
  };
  queue.push({
    ...displayTrack,
    playable: true,
    resolvedTrack,
    script: buildTalkScript(displayTrack, {
      ...context,
      queueIndex
    }),
    scriptSource: "rules"
  });
}

async function enrichQueueScripts(queue, context) {
  const recentLines = [];
  for (const [index, track] of queue.slice(0, 6).entries()) {
    const script = await generateTalkScriptWithLlm({
      track,
      context: { ...context, queueIndex: index, nextTrack: queue[index + 1] || null, recentLines },
      fallbackScript: track.script
    });
    if (script) {
      track.script = script;
      track.scriptSource = "llm";
      recentLines.push(...script.lines);
    } else {
      recentLines.push(...(track.script?.lines || []));
    }
  }
}

function attachProgramFlow(queue, context) {
  const usedLines = [];
  queue.forEach((track, index) => {
    const script = normalizeTalkScript(track.script);
    const nextTrack = queue[index + 1] || null;
    const nextTease = script.nextTease || buildNextTease(track, nextTrack, {
      ...context,
      queueIndex: index
    });
    const closing = script.closing || buildClosing(track, nextTrack, context);
    const dedupedScript = dedupeTalkScript({
      ...script,
      nextTease,
      closing
    }, usedLines);
    const stages = buildTalkStages(dedupedScript, track);
    usedLines.push(...stages.map((stage) => stage.text).filter(Boolean));

    track.script = {
      ...dedupedScript,
      stages,
      lines: stages.map((stage) => stage.text).filter(Boolean)
    };
  });
}

function dedupeTalkScript(script, usedLines) {
  const opening = isTooSimilar(script.opening, usedLines) ? "" : script.opening;
  const bridges = (script.bridges || []).filter((line) => !isTooSimilar(line, usedLines));
  const nextTease = isTooSimilar(script.nextTease, usedLines) ? "" : script.nextTease;
  return {
    opening: opening || bridges.shift() || script.opening,
    bridges: bridges.slice(0, 2),
    nextTease,
    closing: script.closing
  };
}

function normalizeTalkScript(script = {}) {
  const opening = cleanText(script.opening || "");
  const bridges = (Array.isArray(script.bridges) ? script.bridges : [])
    .map((line) => cleanText(line))
    .filter(Boolean)
    .slice(0, 2);
  return {
    opening,
    bridges,
    nextTease: cleanText(script.nextTease || ""),
    closing: cleanText(script.closing || "")
  };
}

function buildTalkStages(script, track) {
  const bridges = script.bridges || [];
  const stages = [
    {
      id: `${track.id}:intro`,
      type: "intro",
      label: "口播 1/3",
      text: script.opening,
      position: "start",
      offsetMs: 1400,
      musicVolume: 0.22
    },
    {
      id: `${track.id}:bridge-a`,
      type: "bridge",
      label: "口播 2/3",
      text: bridges[0],
      position: "percent",
      percent: 0.31,
      minMs: 26000,
      maxBeforeEndMs: 65000,
      musicVolume: 0.2
    },
    {
      id: `${track.id}:bridge-b`,
      type: "bridge",
      label: "口播 3/3",
      text: bridges[1],
      position: "percent",
      percent: 0.64,
      minMs: 62000,
      maxBeforeEndMs: 26000,
      musicVolume: 0.2
    },
    {
      id: `${track.id}:next-tease`,
      type: "next",
      label: "下一首串联",
      text: script.nextTease,
      position: "beforeEnd",
      beforeEndMs: 15000,
      minMs: 90000,
      musicVolume: 0.18
    }
  ].filter((stage) => stage.text);
  if (track.scriptSource !== "llm") {
    return stages.filter((stage) => ["intro", "bridge", "next"].includes(stage.type)).filter((stage, index, list) => {
      if (stage.type !== "bridge") return true;
      return list.findIndex((item) => item.type === "bridge") === index;
    });
  }
  return stages;
}

async function resolveWithTimeout(track, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      resolveCandidate(track),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function resolveCandidate(track) {
  return resolvePlayableTrack({
    songId: track.id,
    title: track.title,
    artist: track.artist,
    providerIds: track.providerIds || [],
    durationSec: track.durationSec || null
  }).catch(() => null);
}

export function buildTalkScript(track, context = {}) {
  const query = cleanText(context.query || "");
  const frame = buildSongFrame(track, query);
  const archetype = pickTalkArchetype(frame);
  const slotCue = buildSlotCue(query, context.queueIndex || 0);
  const opening = chooseLine(buildOpeningOptions(frame, archetype, slotCue), `${track.id}:opening:${archetype}`, query);
  const bridgeOne = chooseLine(buildBridgeOneOptions(frame, archetype), `${track.id}:bridge1:${frame.signature}`, query);
  const bridgeTwo = chooseLine(buildBridgeTwoOptions(frame, archetype), `${track.id}:bridge2:${frame.signature}`, query);

  return {
    opening,
    bridges: [bridgeOne, bridgeTwo],
    lines: [opening, bridgeOne, bridgeTwo]
  };
}

function buildSongFrame(track, query) {
  const mood = firstValue(track.moods) || "松弛";
  const secondMood = nthValue(track.moods, 1) || inferMood(query) || "有呼吸感";
  const scene = firstValue(track.scenes) || inferScene(query) || "夜里";
  const secondScene = nthValue(track.scenes, 1) || "日常";
  const genre = firstValue(track.genres) || inferGenre(query) || "流行";
  const secondGenre = nthValue(track.genres, 1) || "";
  const hook = pickContentHook({ mood, secondMood, scene, secondScene, genre, secondGenre, query }, track.id);
  const signature = [scene, secondScene, mood, secondMood, genre, secondGenre, hook].filter(Boolean).join("|");
  return {
    mood,
    secondMood,
    scene,
    secondScene,
    genre,
    secondGenre,
    hook,
    signature
  };
}

function pickTalkArchetype(frame) {
  const moodText = `${frame.mood} ${frame.secondMood}`;
  if (/R&B|灵魂|soul/i.test(`${frame.genre} ${frame.secondGenre}`)) return "rnb-close";
  if (/(情绪|伤感|失恋|emo)/i.test(frame.mood)) return "emotional-hold";
  if (/(安静|温柔|治愈|轻柔)/.test(moodText)) return "quiet-companion";
  if (/(明亮|开心|甜|清新)/.test(moodText)) return "bright-pop";
  if (/(情绪|伤感|失恋|emo)/i.test(moodText)) return "emotional-hold";
  if (/(通勤|旅行|散步|路上)/.test(`${frame.scene} ${frame.secondScene}`)) return "moving-scene";
  return "steady-pop";
}

function buildOpeningOptions(frame, archetype, slotCue) {
  const byArchetype = {
    "rnb-close": [
      `${slotCue}刚下班的时候，耳机里最好别一上来就太满。留一点低频和呼吸的位置，人会比较容易从白天退出来。`,
      `${slotCue}有些节奏不是催人走快，是让脚步终于有个舒服的拍子。先让这段声音贴着路走，别急着把今天总结完。`,
      `${slotCue}手机屏幕暗下去以后，反而能听见自己还有点紧。这里适合靠近一点，像把领口松开半寸。`
    ],
    "quiet-companion": [
      `${slotCue}有时候人不是需要被劝，只是需要旁边的声音别太用力。先把音量放轻，让这几分钟像一盏不刺眼的灯。`,
      `${slotCue}如果消息还没回完，也可以先不回。生活不会因为一首歌的时间就散架，我们先把手边的紧绷放松一点。`,
      `${slotCue}这段不负责讲大道理，只负责把外面的噪声压低一点。你不用马上变好，先舒服一点就行。`
    ],
    "bright-pop": [
      `${slotCue}车窗外的灯一盏盏过去，人也会想要一点明亮的东西。不是鸡血，就是让疲惫别一直闷在胸口。`,
      `${slotCue}今天不一定要圆满收尾，但可以让心情抬头看一眼。像走出地铁口那一下，空气忽然松了一点。`,
      `${slotCue}这会儿适合开一扇小窗，不用太热闹，只要有一点亮色，就够把路上的沉闷擦掉。`
    ],
    "emotional-hold": [
      `${slotCue}有些情绪不用马上处理，像包里那张皱掉的小票，先放着也没关系。我们不把话说重，只让它被看见一下。`,
      `${slotCue}人累的时候，最怕别人急着给答案。这里不用答案，先给情绪一个边界，让它在旁边坐一会儿。`,
      `${slotCue}如果今天有一点说不清的低落，先别把它归类。很多事不是想明白才过去，是慢慢不再顶着你。`
    ],
    "moving-scene": [
      `${slotCue}路上的时间很奇妙，身体在移动，脑子却还留在刚才那个房间。先让声音陪你过桥，不催你立刻到达。`,
      `${slotCue}等红灯也好，等地铁也好，这几分钟都不必空着。让节奏先往前走一点，人就不用一直卡在白天。`,
      `${slotCue}从公司到家的中间地带，最适合把自己慢慢捡回来。先别急着切换身份，音乐会替你走一段。`
    ],
    "steady-pop": [
      `${slotCue}这段先稳一点，不把情绪推高，也不让它掉下去。像把桌面清出一角，给自己留个能放杯子的地方。`,
      `${slotCue}有时候好的转场不是惊喜，是让人没有负担地继续听下去。这里我们少说一点，把位置让给音乐。`,
      `${slotCue}刚才那点状态不用重新解释。先找一个稳的拍子接住它，让耳朵知道今晚可以慢慢来。`
    ]
  };
  return byArchetype[archetype] || byArchetype["steady-pop"];
}

function buildBridgeOneOptions(frame, archetype) {
  return [
    `刚才这一分钟最好的地方，是它没有急着替你下判断。很多下班后的疲惫，其实只需要先从必须回应的状态里退出来。`,
    `我喜欢这种留白，不是空，是给人一个不用解释自己的地方。外面的声音还在，但你可以暂时不追上每一件事。`,
    frame.secondGenre
      ? `节奏里那点轻微的摆动很有用，它会让身体先放松，脑子才跟得上。人有时候就是需要从肩膀开始慢下来。`
      : `这里的好处是不过分煽情。它像把杯子里的水放稳，水面还会晃，但已经不会洒出来。`,
    archetype === "emotional-hold"
      ? `如果心里还有一点堵，别急着把它讲成故事。先让它只是一点堵，不必马上变成结论。`
      : `这种时候，音乐不用负责解决问题。它只要让你发现，自己其实还能再松一点，就已经够了。`
  ];
}

function buildBridgeTwoOptions(frame, archetype) {
  return [
    `再往后听，就把注意力从白天那些细碎任务里拿回来一点。消息可以晚点回，表情也不用一直撑着。`,
    `有句老话说，不如意事常八九。听起来很旧，但有时候旧话管用，因为它允许人今天先不完美。`,
    frame.hook,
    archetype === "rnb-close"
      ? `等节拍再往前走一点，你会发现人不是突然被治好了，只是终于没那么绷。这个差别很小，但很珍贵。`
      : `我们不把话说满。让剩下的部分继续往前走，你只要跟着听，不用负责把这一晚变得漂亮。`
  ];
}

function buildNextTease(track, nextTrack, context = {}) {
  if (!nextTrack) {
    return chooseLine([
      `这首后半段就不打扰太多了。等它自己收住，我再按你刚才的状态往下接。`,
      `后面先不急着换话题，让这首歌把气口留完整。下一段我会继续顺着这个夜晚往下排。`,
      `听到这里，我们把解释放少一点。等这首走完，电台会继续往前，不让空气突然断掉。`
    ], `${track.id}:final-tease`, context.query || "");
  }

  const nextFrame = buildSongFrame(nextTrack, cleanText(context.query || ""));
  const relation = pickRelation(track, nextTrack);
  return chooseLine([
    `等这首再往后走一点，我们会从${relation}里转出去。下一首是《${nextTrack.title}》，它会把${nextFrame.mood}那面接得更轻。`,
    `这段不用硬收尾。待会儿接到《${nextTrack.title}》的时候，情绪会从${relation}慢慢换一口气。`,
    `如果刚才像把白天放慢，那下一首《${nextTrack.title}》会负责把路继续铺开一点。我们不突然切换，只顺着走。`,
    `后面会接《${nextTrack.title}》。不是为了换热闹，是让这段${nextFrame.scene || "夜里"}的气氛多一个角度。`
  ], `${track.id}:next:${nextTrack.id}`, context.query || "");
}

function buildClosing(track, nextTrack, context = {}) {
  if (nextTrack) return `从《${track.title}》到《${nextTrack.title}》，我们让情绪自然换挡。`;
  return chooseLine([
    "这一段到这里就够了，别把话说满，留一点余味给后面的歌。",
    "剩下的路让音乐自己走，Claudio 会继续在旁边。",
    "今晚不用一次想清楚，听完这一首，再慢慢往下走。"
  ], `${track.id}:closing`, context.query || "");
}

function pickRelation(track, nextTrack) {
  const sharedMood = firstSharedValue(track.moods, nextTrack.moods);
  if (sharedMood) return `${sharedMood}这口气`;
  const sharedScene = firstSharedValue(track.scenes, nextTrack.scenes);
  if (sharedScene) return `${sharedScene}的场景`;
  const sharedGenre = firstSharedValue(track.genres, nextTrack.genres);
  if (sharedGenre) return `${sharedGenre}的质感`;
  return "刚才这口气";
}

function buildSlotCue(query, queueIndex) {
  if (queueIndex <= 0) return buildQueryLine(query);
  return chooseLine([
    "这里不重复刚才的情绪，",
    "走到这儿，换一个角度，",
    "这一首负责把气口接住，",
    "往后一点，我想让情绪有个转身，",
    "这里不继续往下沉，"
  ], `slot:${queueIndex}`, query);
}

function buildQueryLine(query) {
  if (!query) return "先把频道调稳。";
  if (/(下班|通勤|路上|回家|夜里|晚上)/.test(query)) {
    return "你这个状态很像一路把白天收进包里，";
  }
  if (/(放松|松弛|轻松|别太丧|不要太丧)/.test(query)) {
    return "你要的是轻一点的陪伴，";
  }
  if (/(开心|热闹|有劲|提神|振奋)/.test(query)) {
    return "你想把气氛往上托一点，";
  }
  if (/(emo|难过|失眠|想哭|安静)/.test(query)) {
    return "你现在更需要被稳稳接住，";
  }
  return "你刚才说的那句状态，我听懂了，";
}

function pickContentHook(frame, seedText) {
  const sceneHooks = {
    "夜晚": [
      "夜里最怕脑子开着很多后台。先把其中几个关掉，不用一次清空，只要别让它们同时响。",
      "晚上的路灯会把人照得很诚实，累就是累，想安静就是想安静，不需要再包装一下。"
    ],
    "通勤": [
      "通勤像一天的缓冲带，人在路上，心还没完全跟上。给它一点时间，比硬切换有用。",
      "车厢里每个人都像带着一个小小的任务清单，但耳机里可以暂时没有待办事项。"
    ],
    "旅行散步": [
      "散步最好的部分，是不用证明自己走到了哪里。只要脚步还在，心也会慢慢跟着松开。",
      "有些风景不需要拍下来，经过的时候被它轻轻碰一下，就已经算拥有过。"
    ],
    "日常陪伴": [
      "普通日子最需要一点不夸张的声音，像手边一杯温水，不抢存在感，但真的在。",
      "日常不是没有故事，只是很多故事小到没人问。音乐可以替这些小事留个位置。"
    ],
    "学习工作": [
      "工作里的疲惫常常不是大事，是很多小事一起挤在脑子里。先让它们排队，别一起说话。",
      "桌面乱一点也没关系，人的状态也会乱。先从一个能听下去的拍子开始整理。"
    ]
  };
  const moodHooks = {
    "明亮": [
      "明亮不一定是开心，也可以只是愿意把窗帘拉开一点，让今天透一口气。",
      "人有时候不是需要被点燃，只是需要一点点亮色，提醒自己还没完全暗下去。"
    ],
    "情绪": [
      "情绪不是麻烦，它只是提醒你今天确实经过了不少东西。承认它，比立刻压下去更省力。",
      "有些心事说出来太大，不说又硌着。放在音乐里，它会变成比较柔软的形状。"
    ],
    "温柔": [
      "温柔最好的时候不是哄人，是不催人。它允许你慢半拍，也允许你暂时没答案。",
      "这种温柔不是糖，是把锋利的地方包一下，让人可以继续往前走。"
    ],
    "安静": [
      "安静不是没有声音，是终于没有谁催你反应。你可以只听，不用马上给出态度。",
      "把世界调小一点，人会比较容易听见自己真正累在哪里。"
    ]
  };
  const options = [
    ...(sceneHooks[frame.scene] || []),
    ...(sceneHooks[frame.secondScene] || []),
    ...(moodHooks[frame.mood] || []),
    ...(moodHooks[frame.secondMood] || [])
  ];
  return pickBySeed(options.length ? options : [
    "有时候人需要的不是新道理，是一个可以停半分钟的地方。先停一下，再继续也来得及。",
    "今天剩下的部分不用全部安排好。先让这一小段声音把空白垫住，别让脑子一直悬着。"
  ], seedText);
}

function inferMood(query) {
  if (/(放松|松弛|轻松)/.test(query)) return "松弛";
  if (/(开心|热闹|有劲|提神|振奋)/.test(query)) return "明亮";
  if (/(emo|难过|失眠|想哭|安静|别太丧|不要太丧)/.test(query)) return "安静";
  return "";
}

function inferScene(query) {
  if (/(下班|路上|通勤|回家)/.test(query)) return "路上";
  if (/(夜里|晚上|深夜|凌晨)/.test(query)) return "夜里";
  if (/(午后|下午|下午茶)/.test(query)) return "午后";
  return "";
}

function inferGenre(query) {
  if (/(华语|国语|中文)/.test(query)) return "华语";
  if (/(粤语)/.test(query)) return "粤语";
  if (/(民谣|木吉他)/.test(query)) return "民谣";
  if (/(R&B|灵魂|soul)/i.test(query)) return "R&B";
  return "";
}

function chooseLine(options, seedText = "", query = "") {
  const seed = hashText(`${seedText}::${query}`);
  return options[seed % options.length];
}

function isTooSimilar(line, usedLines = []) {
  const key = normalizeSimilarity(line);
  if (!key || key.length < 12) return false;
  const linePhrases = signaturePhrases(line);
  return usedLines.some((used) => {
    const usedKey = normalizeSimilarity(used);
    if (!usedKey) return false;
    const sharedPhrase = linePhrases.some((phrase) => signaturePhrases(used).includes(phrase));
    return sharedPhrase || key.includes(usedKey.slice(0, 14)) || usedKey.includes(key.slice(0, 14)) || overlapScore(key, usedKey) > 0.62;
  });
}

function normalizeSimilarity(value = "") {
  return cleanText(value)
    .replace(/[《》“”"'，。！？、,.!?]/g, "")
    .replace(/\s+/g, "")
    .slice(0, 80);
}

function overlapScore(left, right) {
  const leftTokens = new Set(left.match(/[\u4e00-\u9fff]{2}|[a-z0-9]{3,}/gi) || []);
  const rightTokens = new Set(right.match(/[\u4e00-\u9fff]{2}|[a-z0-9]{3,}/gi) || []);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function signaturePhrases(value = "") {
  const clean = cleanText(value);
  const phrases = [
    "身体先松下来",
    "肩膀先松下来",
    "白天拧着",
    "温柔的拉扯",
    "不急着解决",
    "不急着给答案",
    "不把话说满",
    "把解释放少一点"
  ];
  return phrases.filter((phrase) => clean.includes(phrase));
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function firstValue(items = []) {
  return items[0]?.value || "";
}

function nthValue(items = [], index) {
  return items[index]?.value || "";
}

function firstSharedValue(left = [], right = []) {
  const rightValues = new Set((right || []).map((item) => item.value).filter(Boolean));
  return (left || []).find((item) => rightValues.has(item.value))?.value || "";
}

function pickBySeed(items = [], seedText = "") {
  if (!items.length) return null;
  return items[hashText(seedText) % items.length];
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}
