import { loadProfile, recommend } from "./recommender.js";
import { resolvePlayableTrack } from "./music.js";
import { getCleanPlayableRecord } from "./playable-index.js";
import { generateTalkScriptWithLlm } from "./llm.js";
import { fetchSongContext } from "./song-context.js";
import { fetchArtistContext } from "./artist-context.js";
import { fetchBeijingBroadcastContext } from "./broadcast-context.js";
import { buildProgramBrief } from "./program-brief.js";
import { planRadioQueue } from "./queue-planner.js";
import { buildShowTalkPlan, buildTrackContentPack } from "./content-pack.js";
import { getTalkVoiceProfile, scoreTalkLineQuality } from "./talk-voice.js";

export async function buildRadioProgram({ query = "", limit = 6, maxWaitMs = 0, refreshSeed = "", avoidIds = [], scriptBudgetMs = 28000, songContextBudgetMs = 1800, artistContextBudgetMs = 1500, broadcastContext = null, songContextProvider = fetchSongContext, artistContextProvider = fetchArtistContext } = {}) {
  const profile = loadProfile();
  const brief = buildProgramBrief(query);
  const resolveLimit = brief.format === "city-editorial" ? Math.min(Math.max(limit * 3, limit + 8), 18) : limit;
  const cachedScanLimit = brief.format === "city-editorial" ? Math.min(Math.max(resolveLimit * 3, resolveLimit), 36) : resolveLimit;
  const broadcast = broadcastContext || await fetchBeijingBroadcastContext({
    city: brief.city || "北京",
    editorialMode: "test",
    now: inferBroadcastNowFromQuery(query)
  });
  const candidateLimit = refreshSeed || avoidIds.length ? Math.max(90, limit * 10) : Math.max(24, limit * 6);
  const raw = recommend({ query, limit: candidateLimit, refreshSeed, avoidIds });
  const queue = [];
  const rejected = [];
  const candidates = planRadioQueue({
    candidates: (raw.recommendations || []).slice(0, Math.max(24, candidateLimit)),
    brief,
    limit: Math.max(24, candidateLimit)
  });
  const usedIds = new Set();
  const explicitCandidates = candidates.filter(hasExplicitRequestEvidence);
  if (explicitCandidates.length) {
    await resolveCandidatesIntoQueue(queue, explicitCandidates, {
      limit: Math.min(resolveLimit, Math.max(3, explicitCandidates.length)),
      maxWaitMs: Math.max(maxWaitMs || 0, 6500),
      query,
      profile,
      anchors: raw.anchors || [],
      rejected,
      usedIds
    });
  }
  for (const track of candidates) {
    if (usedIds.has(track.id)) continue;
    const cached = getCleanPlayableRecord(track.id, track);
    if (!cached?.streamUrl) continue;
    pushPlayable(queue, track, cached, { query, profile, anchors: raw.anchors || [] });
    usedIds.add(track.id);
    if (queue.length >= cachedScanLimit) break;
  }

  if (queue.length < resolveLimit) {
    const remaining = candidates.filter((track) => !usedIds.has(track.id));
    const budgetMs = maxWaitMs || (queue.length ? 1900 : 3200);
    await resolveCandidatesIntoQueue(queue, remaining, {
      limit: resolveLimit,
      maxWaitMs: budgetMs,
      query,
      profile,
      anchors: raw.anchors || [],
      rejected,
      usedIds
    });
  }

  for (const track of candidates) {
    if (queue.some((item) => item.id === track.id) || rejected.some((item) => item.id === track.id)) continue;
    rejected.push({ id: track.id, title: track.title, artist: track.artist, reason: "本轮时间内未完成解析" });
  }

  replanPlayableQueue(queue, brief, limit);
  await enrichSongContexts(queue, { budgetMs: songContextBudgetMs, songContextProvider });
  await enrichArtistContexts(queue, { budgetMs: artistContextBudgetMs, artistContextProvider });
  attachContentPacks(queue, { brief, broadcastContext: broadcast });
  const showTalkPlan = buildShowTalkPlan({ brief, packs: queue.map((track) => track.contentPack) });
  queue.forEach((track, queueIndex) => {
    track.script = buildTalkScript(track, {
      query,
      brief,
      showTalkPlan,
      profile,
      anchors: raw.anchors || [],
      queueIndex,
      songContext: track.songContext,
      broadcastContext: broadcast,
      contentPack: track.contentPack
    });
    track.scriptSource = "rules";
  });
  await enrichQueueScripts(queue, { query, brief, showTalkPlan, profile, anchors: raw.anchors || [], budgetMs: scriptBudgetMs, broadcastContext: broadcast });
  attachProgramFlow(queue, { query, brief, showTalkPlan, profile, anchors: raw.anchors || [] });

  return {
    query,
    brief,
    rawCount: (raw.recommendations || []).length,
    rejected,
    queue,
    profile: raw.profile,
    anchors: raw.anchors,
    broadcastContext: broadcast,
    showTalkPlan
  };
}

async function resolveCandidatesIntoQueue(queue, candidates, context) {
  const startedAt = Date.now();
  const budgetMs = Math.max(0, context.maxWaitMs || 0);
  for (let index = 0; index < candidates.length && queue.length < context.limit; index += 4) {
    const timeLeft = budgetMs - (Date.now() - startedAt);
    if (timeLeft < 500) break;
    const batch = candidates.slice(index, index + 4);
    const results = await Promise.allSettled(batch.map((track) => resolveWithTimeout(track, Math.min(1800, timeLeft))));
    results.forEach((result, batchIndex) => {
      const track = batch[batchIndex];
      if (queue.length >= context.limit || context.usedIds.has(track.id)) return;
      context.usedIds.add(track.id);
      if (result.status !== "fulfilled" || !result.value) {
        context.rejected.push({ id: track.id, title: track.title, artist: track.artist, reason: "音源不可播或匹配不可靠" });
        return;
      }
      pushPlayable(queue, track, result.value, {
        query: context.query,
        profile: context.profile,
        anchors: context.anchors || []
      });
    });
  }
}

function hasExplicitRequestEvidence(track = {}) {
  return (track.evidence || []).some((item) => String(item).includes("这次点名想听"));
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
    programSlot: track.programSlot || "",
    programSlotLabel: track.programSlotLabel || "",
    programReason: track.programReason || "",
    playable: true,
    resolvedTrack,
    script: buildTalkScript(displayTrack, {
      ...context,
      queueIndex
    }),
    scriptSource: "rules"
  });
}

function attachContentPacks(queue, { brief, broadcastContext }) {
  queue.forEach((track, index) => {
    track.contentPack = buildTrackContentPack({
      track,
      brief,
      songContext: track.songContext,
      artistContext: track.artistContext,
      broadcastContext,
      previousTrack: queue[index - 1] || null,
      nextTrack: queue[index + 1] || null
    });
  });
}

function replanPlayableQueue(queue, brief, limit = queue.length) {
  const planned = planRadioQueue({ candidates: queue, brief, limit });
  queue.splice(0, queue.length, ...planned);
}

async function enrichQueueScripts(queue, context) {
  const recentLines = [];
  const startedAt = Date.now();
  const budgetMs = Math.max(0, Number(context.budgetMs) || 0);
  for (const [index, track] of queue.slice(0, 6).entries()) {
    const elapsed = Date.now() - startedAt;
    const timeLeft = budgetMs - elapsed;
    if (timeLeft < 650) {
      track.scriptLlmStatus = { ok: false, reason: "budget_exhausted", timeLeft };
      recentLines.push(...(track.script?.lines || []));
      continue;
    }
    const script = await generateTalkScriptWithLlm({
      track,
      context: { ...context, queueIndex: index, nextTrack: queue[index + 1] || null, recentLines, songContext: track.songContext, contentPack: track.contentPack },
      fallbackScript: track.script,
      timeoutMs: computeLlmScriptTimeout({ index, timeLeft, budgetMs })
    });
    if (script && !script.rejected) {
      track.script = script;
      track.scriptSource = "llm";
      track.scriptLlmStatus = { ok: true };
      recentLines.push(...script.lines);
    } else {
      track.scriptLlmStatus = { ok: false, reason: script?.reason || "llm_returned_null_or_timed_out", timeLeft };
      recentLines.push(...(track.script?.lines || []));
    }
  }
}

function computeLlmScriptTimeout({ index = 0, timeLeft = 0, budgetMs = 0 } = {}) {
  const available = Math.max(500, Number(timeLeft) || 0);
  if (index === 0) return Math.min(9000, available);
  if (index <= 3 && budgetMs >= 18000) return Math.min(9000, available);
  if (index <= 2 && budgetMs >= 12000) return Math.min(7000, available);
  if (index === 1 && budgetMs >= 7000) return Math.min(4800, available);
  return Math.min(4000, available);
}

async function enrichSongContexts(queue, { budgetMs = 1800, songContextProvider = fetchSongContext } = {}) {
  const startedAt = Date.now();
  const targets = queue.slice(0, 5);
  for (const track of targets) {
    const timeLeft = Math.max(0, budgetMs - (Date.now() - startedAt));
    if (timeLeft < 250) break;
    const songContext = await songContextProvider(track, { timeoutMs: Math.min(900, timeLeft) });
    if (songContext?.storySummary || songContext?.hotCommentThemes?.length) {
      track.songContext = songContext;
    }
  }
}

async function enrichArtistContexts(queue, { budgetMs = 1500, artistContextProvider = fetchArtistContext } = {}) {
  const startedAt = Date.now();
  const targets = queue.slice(0, 4);
  for (const track of targets) {
    const timeLeft = Math.max(0, budgetMs - (Date.now() - startedAt));
    if (timeLeft < 250) break;
    const artistContext = await artistContextProvider(track, { timeoutMs: Math.min(900, timeLeft) });
    if (artistContext?.brief || artistContext?.facts?.length) {
      track.artistContext = artistContext;
    }
  }
}

function attachProgramFlow(queue, context) {
  const usedLines = [];
  const stockPhraseCounts = new Map();
  queue.forEach((track, index) => {
    const script = normalizeTalkScript(track.script);
    const nextTrack = queue[index + 1] || null;
    const nextTease = script.nextTease || buildNextTease(track, nextTrack, {
      ...context,
      queueIndex: index
    });
    const closing = script.closing || buildClosing(track, nextTrack, context);
    const deduped = dedupeTalkScript({
      ...script,
      nextTease,
      closing
    }, usedLines, track);
    if (nextTrack && !deduped.nextTease) {
      deduped.nextTease = buildNextTease(track, nextTrack, {
        ...context,
        queueIndex: index
      });
    }
    const dedupedScript = diversifyStockPhrases(anchorTalkScript(deduped, track, nextTrack), track, nextTrack, {
      ...context,
      queueIndex: index,
      stockPhraseCounts
    });
    const stages = buildTalkStages(dedupedScript, track);
    usedLines.push(...stages.map((stage) => stage.text).filter(Boolean));

    track.script = {
      ...dedupedScript,
      stages,
      lines: stages.map((stage) => stage.text).filter(Boolean)
    };
  });
}

function diversifyStockPhrases(script, track, nextTrack, context = {}) {
  const stockPhraseCounts = context.stockPhraseCounts || new Map();
  return {
    ...script,
    opening: replaceRepeatedStockPhrases(script.opening, track, nextTrack, context, stockPhraseCounts),
    bridges: (script.bridges || []).map((line) => replaceRepeatedStockPhrases(line, track, nextTrack, context, stockPhraseCounts)),
    nextTease: replaceRepeatedStockPhrases(script.nextTease, track, nextTrack, context, stockPhraseCounts),
    closing: replaceRepeatedStockPhrases(script.closing, track, nextTrack, context, stockPhraseCounts)
  };
}

function replaceRepeatedStockPhrases(line, track, nextTrack, context, stockPhraseCounts) {
  let result = sanitizeTalkCopy(line || "");
  if (!result) return result;
  const replacements = buildStockPhraseReplacements(track, nextTrack, context);
  for (let pass = 0; pass < 2; pass += 1) {
    for (const [phrase, alternates] of Object.entries(replacements)) {
      if (!result.includes(phrase)) continue;
      const count = stockPhraseCounts.get(phrase) || 0;
      if (count > 0) {
        result = result.replace(phrase, alternates[(count - 1) % alternates.length]);
      }
      stockPhraseCounts.set(phrase, count + 1);
    }
  }
  result = replaceRepeatedCityBackground(result, track, context, stockPhraseCounts);
  return result;
}

function buildStockPhraseReplacements(track, nextTrack, context = {}) {
  const title = cleanText(track?.title || "这首歌");
  const nextTitle = cleanText(nextTrack?.title || "下一首");
  const relation = nextTrack ? pickRelation(track, nextTrack) : "这口气";
  return {
    "生活不会因为一首歌的时间就散架": [
      "没回完的消息可以先停在屏幕里",
      "不用急着把所有事处理完",
      `《${title}》先替你把这一小段空白垫住`
    ],
    "不负责劝人，只负责别太用力地陪着": [
      "不急着讲道理，只把音量放轻一点",
      "不替你总结今天，只让旁边那点吵慢慢退下去",
      `《${title}》不是来讲道理的，只是把这一刻托稳一点`
    ],
    "不是硬转场": [
      "不会突然把方向拧走",
      "不会把情绪生硬折过去",
      `会让节奏先不断开，再慢慢接到下一段`
    ],
    "不是为了换热闹": [
      "不是为了把气氛突然抬高",
      "不是为了急着换一个表情",
      `只是让${relation}有个更自然的出口`
    ],
    "走到这儿，换一个角度": [
      "让耳朵换一条路走",
      "这里换一个更稳的速度",
      "这一首先稳住节奏"
    ],
    "让耳朵换一条路走": [
      "这里换一个更稳的速度",
      "这一首先稳住节奏",
      "换一个角度听"
    ],
    "把频道稍微拨暗一点": [
      "这一首先稳住节奏",
      "换一个角度听",
      "让这段声音靠近一点"
    ],
    "这一首先稳住节奏": [
      "换一个角度听",
      "让这段声音靠近一点",
      "这里先不急着翻篇"
    ],
    "换一束侧光进来": [
      "让这段声音靠近一点",
      "这里先不急着翻篇",
      "把这段路走得慢一点"
    ],
    "如果刚才像把白天放慢": [
      "如果前一段像把肩膀松开一点",
      "如果刚才那首把路灯调暗了一些",
      "如果这一路已经慢下来一点"
    ],
    "等这首再往后走一点": [
      "等这一段把尾巴留住",
      "等声音再往里收一点",
      "等情绪自然换一口气"
    ],
    "别一上来就太满": [
      "不要急着把情绪推满",
      "先别把声音塞得太紧",
      "让开头留一点空气"
    ],
    "外面，还有一层听众自己的生活": [
      "不只属于歌手，也被听众带进自己的生活里",
      "评论里能看到它被带进不同人的日常",
      "被很多人放进毕业、告别或回家的具体时刻"
    ],
    "放在今晚里，它不像资料卡，更像有人把一句没说完的话递到耳边": [
      "今晚听到这里，评论里的城市、车站或教室会让歌曲更具体",
      "放在今晚，它把歌里没说透的告别或期待留出来一点",
      "在今晚这段路上，它让一首歌多了一点真实场景"
    ],
    "今晚北京的通勤尾声": [
      "这一次把北京背景收轻一点",
      "这首先不再重复城市开场",
      "这里把镜头放回歌和歌手"
    ],
    "北京今晚的通勤尾声": [
      "这一次把北京背景收轻一点",
      "这首先不再重复城市开场",
      "这里把镜头放回歌和歌手"
    ],
    "地铁和环路": [
      "歌曲自己的画面",
      "歌手声音里的细节",
      "这首歌的场景"
    ],
    "地铁口和环路": [
      "歌曲自己的画面",
      "歌手声音里的细节",
      "这首歌的场景"
    ],
    "写字楼的灯慢慢暗下去": [
      "别让同一段城市背景抢走音乐",
      "让开场少一点模板味",
      "把注意力留给这首歌本身"
    ],
    "这首歌适合放在回家路上那十几分钟": [
      "可以把注意力放回这首歌本身",
      "先听它和上一首不同的地方",
      "让这一段从歌手和声音开始"
    ]
  };
}

function replaceRepeatedCityBackground(line, track, context = {}, stockPhraseCounts = new Map()) {
  const clean = cleanText(line || "");
  if (!clean || !mentionsRepeatedCityBackground(clean, stockPhraseCounts)) return clean;
  const title = cleanText(track?.title || "这首歌");
  const artist = cleanText(track?.artist || "").split("/")[0].trim();
  const genre = firstValue(track?.genres) || nthValue(track?.genres, 1) || "这类声音";
  const scene = firstValue(track?.scenes) || "这一段";
  const mood = firstValue(track?.moods) || "当前状态";
  const queueIndex = Number(context.queueIndex || 0);
  const options = [
    artist
      ? `《${title}》这里不再重复北京背景，先听${artist}的声音怎样把${genre}和${scene}接在一起。`
      : `《${title}》这里不再重复北京背景，先听它怎样把${genre}和${scene}接在一起。`,
    `《${title}》这一段把镜头从城市切回歌曲本身，重点放在${genre}、${mood}和你这次想听的方向。`,
    artist
      ? `到《${title}》和${artist}这里，城市只留作底色，真正要听的是这首歌和前一首不同的纹理。`
      : `到《${title}》这里，城市只留作底色，真正要听的是这首歌和前一首不同的纹理。`
  ];
  return options[queueIndex % options.length];
}

function mentionsRepeatedCityBackground(line, stockPhraseCounts = new Map()) {
  const repeatedSignals = [
    "今晚北京的通勤尾声",
    "北京今晚的通勤尾声",
    "地铁和环路",
    "地铁口和环路",
    "写字楼的灯慢慢暗下去",
    "这首歌适合放在回家路上那十几分钟"
  ];
  return repeatedSignals.some((signal) => line.includes(signal) && (stockPhraseCounts.get(signal) || 0) > 1);
}

function dedupeTalkScript(script, usedLines, track = {}) {
  const opening = mentionsTrack(script.opening, track) || !isTooSimilar(script.opening, usedLines) ? script.opening : "";
  const bridges = (script.bridges || []).filter((line) => mentionsTrack(line, track) || !isTooSimilar(line, usedLines));
  const nextTease = isTooSimilar(script.nextTease, usedLines) ? "" : script.nextTease;
  return {
    opening: opening || bridges.shift() || script.opening,
    bridges: bridges.slice(0, 2),
    nextTease,
    closing: script.closing
  };
}

function anchorTalkScript(script, track, nextTrack) {
  return {
    ...script,
    opening: ensureCurrentTrackAnchor(script.opening, track),
    nextTease: nextTrack ? ensureNextTrackAnchor(script.nextTease, nextTrack) : script.nextTease
  };
}

function ensureCurrentTrackAnchor(line, track = {}) {
  const clean = cleanText(line || "");
  if (!clean || mentionsTrack(clean, track)) return clean;
  const title = cleanText(track.title || "");
  const artist = cleanText(track.artist || "").split("/")[0].trim();
  if (title && artist) return `《${title}》这首由${artist}唱出来，${clean}`;
  if (title) return `《${title}》先放在这里，${clean}`;
  return clean;
}

function ensureNextTrackAnchor(line, nextTrack = {}) {
  const clean = cleanText(line || "");
  if (!clean || mentionsTrack(clean, nextTrack)) return clean;
  const title = cleanText(nextTrack.title || "");
  const artist = cleanText(nextTrack.artist || "").split("/")[0].trim();
  if (title && artist) return `${clean}，待会儿接到《${title}》和${artist}的时候，节奏会自然往前走。`;
  if (title) return `${clean}，待会儿接到《${title}》的时候，节奏会自然往前走。`;
  return clean;
}

function mentionsTrack(line, track = {}) {
  const clean = cleanText(line || "");
  const title = cleanText(track.title || "");
  const artist = cleanText(track.artist || "").split("/")[0].trim();
  return Boolean((title && clean.includes(title)) || (artist && clean.includes(artist)));
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
  const songCue = buildSongCue(track, frame);
  const songNoun = buildSongNoun(track, frame);
  const shortSongNoun = buildShortSongNoun(track);
  const storyLine = buildStoryLine(track, context.songContext, context.broadcastContext, context);
  const broadcastLine = buildBroadcastLine(context.broadcastContext, track, frame, context.contentPack, context.showTalkPlan);
  const showOpening = buildShowOpeningLine(track, frame, context.contentPack, context.showTalkPlan);
  const voiceProfile = context.showTalkPlan?.voiceProfile || getTalkVoiceProfile("default");
  const opening = polishLineForVoice(
    sanitizeTalkCopy(showOpening || chooseLine(buildOpeningOptions(frame, archetype, songCue), `${track.id}:opening:${archetype}`, query)),
    { role: "opening", track, frame, voiceProfile }
  );
  const bridgeOne = polishLineForVoice(
    sanitizeTalkCopy(storyLine || chooseLine(buildBridgeOneOptions(frame, archetype, shortSongNoun), `${track.id}:bridge1:${frame.signature}`, query)),
    { role: "bridge", track, frame, voiceProfile }
  );
  const bridgeTwo = polishLineForVoice(
    sanitizeTalkCopy(broadcastLine || chooseLine(buildBridgeTwoOptions(frame, archetype), `${track.id}:bridge2:${frame.signature}`, query)),
    { role: "bridge", track, frame, voiceProfile }
  );

  return {
    opening,
    bridges: [bridgeOne, bridgeTwo],
    lines: [opening, bridgeOne, bridgeTwo]
  };
}

function polishLineForVoice(line, { role = "bridge", track = {}, frame = {}, voiceProfile = getTalkVoiceProfile("default") } = {}) {
  const clean = sanitizeTalkCopy(line);
  const quality = scoreTalkLineQuality(clean, voiceProfile);
  if (quality.ok) return clean;
  const title = cleanText(track.title || "这首歌");
  const artist = cleanText(track.artist || "").split("/")[0].trim();
  const cityCue = frame.scene || "回家路上";
  const genreCue = frame.genre || frame.secondGenre || "流行";
  if (role === "opening") {
    return artist
      ? `《${title}》由${artist}唱出来，先把${cityCue}和${genreCue}这两个入口交代清楚。`
      : `《${title}》先放在这里，把${cityCue}和${genreCue}这两个入口交代清楚。`;
  }
  return `《${title}》这一段不靠空话撑场，重点放在${cityCue}、${genreCue}和你这次想听的方向上。`;
}

function buildBroadcastLine(broadcastContext = {}, track = {}, frame = {}, contentPack = null, showTalkPlan = null) {
  const timeCue = cleanText(broadcastContext?.timeCue || "");
  const weather = cleanText(broadcastContext?.weatherSummary || "");
  const news = cleanText(broadcastContext?.newsSummary || "");
  const editorial = buildEditorialLine(broadcastContext, track, frame, contentPack, showTalkPlan);
  if (editorial) return editorial;
  if (!weather && !news) return "";
  const prefix = timeCue ? `${timeCue}，` : "这会儿，";
  if (weather && news) {
    return `${prefix}${weather}；新闻里${news}。先不用急着追完所有信息，让这首歌把注意力放回耳朵里。`;
  }
  if (weather) {
    return `${prefix}${weather}。天气只是背景，不抢音乐的位置，只让这一小段听起来更贴近现在。`;
  }
  return `${prefix}新闻里${news}。我们点到为止，不把信息塞满，把剩下的空间留给音乐。`;
}

function buildEditorialLine(broadcastContext = {}, track = {}, frame = {}, contentPack = null, showTalkPlan = null) {
  const localScene = cleanText(broadcastContext?.localSceneSummary || "");
  const newsBrief = pickBriefText(broadcastContext?.newsBriefs, track.id || track.title || "news");
  const cultureBrief = pickBriefText(broadcastContext?.cultureBriefs, `${track.id || track.title || "culture"}:culture`);
  const angles = (broadcastContext?.editorialAngles || []).map((item) => cleanText(item)).filter(Boolean);
  const angle = angles.length ? pickBySeed(angles, `${track.id || track.title}:angle`) : "";
  const city = cleanText(broadcastContext?.city || "");
  const timeCue = cleanText(broadcastContext?.timeCue || "");
  if (!localScene && !newsBrief && !cultureBrief && !angle) return "";
  const trackScene = frame.scene || frame.secondScene || "这一段";
  const mood = frame.mood || frame.secondMood || "现在的心情";
  const title = cleanText(track.title || "这首歌");
  const motif = pickShowMotif(showTalkPlan, track);
  const concreteMotif = concreteMotifForCopy(motif);
  const selectionCue = buildSelectionCue(contentPack || track);
  const line = chooseLine([
    `${city || timeCue || "这会儿"}的背景可以轻轻带一下：${stripEndingPunctuation(localScene || newsBrief)}。放回《${title}》里，${trackScene}和${mood}就不只是情绪，也像这期节目里的${concreteMotif || "一个真实城市切面"}。`,
    `${newsBrief || localScene}。这条资讯不用展开成新闻播报，它更像给《${cleanText(track.title || "这首歌")}》加一层现实底色：人还在城市里赶路，歌里也能留下${concreteMotif || "一段清楚的回家路"}。`,
    `${cultureBrief || localScene}。接到《${title}》时，可以把${concreteMotifForCopy(angle) || concreteMotif || "地铁口和路灯"}当成画面背景，让这首歌落在今晚的北京。`,
    `${stripEndingPunctuation(localScene || cultureBrief)}。外面的信息很多，${newsBrief || "真正能留下来的，是人下班以后那段回家路"}；放到《${title}》旁边，${selectionCue ? `${selectionCue}，` : ""}把城市压低成一个背景，不抢歌。`
  ].filter(Boolean), `${track.id}:editorial:${localScene}:${newsBrief}:${cultureBrief}`, frame.signature || "");
  return tidyPunctuation(line);
}

function buildSelectionCue(packOrTrack = {}) {
  const slot = cleanText(packOrTrack.programSlot || "");
  const reason = cleanText(packOrTrack.selectionReason || packOrTrack.programReason || "");
  if (slot === "story" || /热评|故事|私人记忆/.test(reason)) return "这里可以多说一点听众故事";
  if (slot === "city" || /城市|北京|资讯/.test(reason)) return "这里可以带一点北京和资讯背景";
  if (slot === "turn" || /换一个角度|转向/.test(reason)) return "这里把节目换到另一个角度";
  if (slot === "closer" || /收尾|余味/.test(reason)) return "这里给这一段留一个完整收尾";
  return "";
}

function buildShowOpeningLine(track = {}, frame = {}, contentPack = null, showTalkPlan = null) {
  if (contentPack?.programSlot !== "opener" || !showTalkPlan?.showThesis) return "";
  const title = cleanText(track.title || "");
  const artist = cleanText(track.artist || "").split("/")[0].trim();
  const songNoun = title && artist ? `《${title}》这首由${artist}唱出来的${[frame.genre, frame.secondGenre].filter(Boolean).join("和") || "歌"}` : title ? `《${title}》` : "这首歌";
  const thesis = cleanText(showTalkPlan.showThesis)
    .replace(/^这是一档关于/, "")
    .replace(/^这是一档/, "")
    .replace(/：.*$/, "");
  const motif = pickShowMotif(showTalkPlan, track);
  return `${songNoun}先开场。这期会围绕${thesis || "北京夜里的歌和故事"}来排，${concreteMotifForCopy(motif) || "地铁口、环路和下班后的几分钟"}会穿在几首歌之间。`;
}

function pickShowMotif(showTalkPlan = null, track = {}) {
  const motifs = (showTalkPlan?.recurringMotifs || []).map((item) => cleanText(item)).filter(Boolean);
  return pickBySeed(motifs, `${track.id || track.title || "motif"}:show-motif`) || "";
}

function concreteMotifForCopy(motif = "") {
  const clean = cleanText(motif);
  if (!clean) return "";
  return clean
    .replace(/通勤后的私人时间/g, "下班后从写字楼到地铁口那段路")
    .replace(/耳机里的自留地/g, "耳机里这几分钟")
    .replace(/城市夜生活和耳机里的自留地/g, "散场后的路灯和耳机里的歌")
    .replace(/信息很多但心要慢一点/g, "资讯很多但只取和这首歌有关的一点")
    .replace(/城市里的私人时间/g, "城市里下班后的几分钟");
}

function pickBriefText(briefs = [], seedText = "") {
  const items = (briefs || [])
    .map((item) => cleanText(typeof item === "string" ? item : item?.text || ""))
    .filter(Boolean);
  return pickBySeed(items, seedText) || "";
}

function inferBroadcastNowFromQuery(query = "") {
  const text = cleanText(query);
  if (/(深夜|凌晨|睡前|失眠)/.test(text)) return makeBeijingDateAtHour(23);
  if (/(晚上|夜里|今晚|下班|回家|晚高峰)/.test(text)) return makeBeijingDateAtHour(21);
  if (/(早上|清晨|早高峰|上班)/.test(text)) return makeBeijingDateAtHour(8);
  if (/(中午|午休|午间)/.test(text)) return makeBeijingDateAtHour(12);
  if (/(下午|午后)/.test(text)) return makeBeijingDateAtHour(15);
  return new Date();
}

function makeBeijingDateAtHour(hour) {
  return new Date(`2026-06-18T${String(hour).padStart(2, "0")}:00:00+08:00`);
}

function stripEndingPunctuation(value = "") {
  return cleanText(value).replace(/[。；;，,]+$/g, "");
}

function tidyPunctuation(value = "") {
  return cleanText(value)
    .replace(/。{2,}/g, "。")
    .replace(/；{2,}/g, "；")
    .replace(/，{2,}/g, "，")
    .replace(/。；/g, "；")
    .replace(/；。/g, "。");
}

function buildStoryLine(track, songContext = {}, broadcastContext = {}, context = {}) {
  const storySummary = cleanText(songContext?.storySummary || "");
  const themes = (songContext?.hotCommentThemes || [])
    .map((theme) => cleanText(theme))
    .filter(Boolean)
    .slice(0, 2);
  const excerpt = pickCommentExcerpt(songContext?.commentExcerpts, track);
  if (!storySummary && !themes.length && !excerpt) return "";
  const title = cleanText(track.title || "");
  const artist = cleanText(track.artist || "").split("/")[0].trim();
  const trackLabel = title && artist ? `《${title}》这首歌，在${artist}的声音里` : title ? `《${title}》这首歌` : "这首歌";
  const titleLabel = title ? `《${title}》` : "这首歌";
  const weather = Number(context.queueIndex || 0) <= 0 ? cleanText(broadcastContext?.weatherSummary || "") : "";
  const timeCue = cleanText(broadcastContext?.timeCue || "");
  const contextCue = buildContextCue({ timeCue, weather });
  const story = normalizeStorySummary(storySummary, title) || `评论里有几条很像私人故事：${themes.join("；")}。`;
  const options = buildStoryLineOptions({ trackLabel, titleLabel, story, excerpt, contextCue, title, artist });
  return excerpt ? options[0] : chooseLine(options, `${track.id}:story:${story}:${excerpt}`, title);
}

function buildStoryLineOptions({ trackLabel, titleLabel, story, excerpt, contextCue, title, artist }) {
  const sceneTail = contextCue
    ? `${contextCue}，它不像资料卡，更像有人把一句没说完的话递到耳边。`
    : "我不直接复述原话，只借它留下一点听众真实生活的重量。";
  const artistCue = artist ? `${artist}的声音没有替这些故事下结论，只把它们放得轻一点。` : "这首歌没有替这些故事下结论，只把它们放得轻一点。";
  const titleCue = title ? `《${title}》` : "这首歌";
  const excerptLine = excerpt
    ? `评论里有一句可以放在这里：“${excerpt}” ${contextCue ? `${contextCue}，` : ""}这比单纯介绍${titleCue}更像一个真实入口。`
    : "";
  return [
    excerptLine,
    `${titleLabel}外面，还有一层听众自己的生活，${story}${sceneTail}`,
    `评论里留下的不是统一答案，${story}${artistCue}`,
    `如果把这首歌当成一面小小的留言墙，${story}我们听到这里就够了，不把别人的故事讲满。`,
    `${titleCue}的好听，有一部分来自它被很多人带进了自己的生活。${story}这一段我们少解释，让音乐自己把那层关系托住。`
  ].filter(Boolean);
}

function buildContextCue({ timeCue = "", weather = "" } = {}) {
  const cleanTime = cleanText(timeCue);
  const cleanWeather = cleanText(weather);
  if (cleanTime && cleanWeather) return `${cleanTime}听，外面${cleanWeather}`;
  if (cleanWeather) return `外面${cleanWeather}`;
  if (cleanTime) return `${cleanTime}听`;
  return "";
}

function pickCommentExcerpt(excerpts = [], track = {}) {
  const items = (excerpts || [])
    .map((item) => cleanText(typeof item === "string" ? item : item?.text || ""))
    .filter((text) => text.length >= 8 && text.length <= 90)
    .filter((text) => !isUnsafeCommentExcerpt(text));
  return pickBySeed(items, `${track.id || track.title || "comment"}:excerpt`) || "";
}

function isUnsafeCommentExcerpt(text = "") {
  return /求赞|互粉|打卡|沙发|第一|999|网易云|热评|点赞|感谢大家|谢谢大家|\[[^\]]+\]|https?:\/\//i.test(text);
}

function normalizeStorySummary(storySummary, title) {
  const clean = cleanText(storySummary || "");
  if (!clean) return "";
  const titlePattern = title ? `《${escapeRegExp(title)}》下面的评论更像一组私人故事：` : "";
  return clean
    .replace(titlePattern ? new RegExp(titlePattern, "g") : /^$/, "")
    .replace(/^这首歌下面的评论更像一组私人故事：/, "")
    .trim();
}

function buildSongCue(track, frame) {
  return `${buildSongNoun(track, frame)}，`;
}

function buildShortSongNoun(track) {
  const title = cleanText(track.title || "");
  const artist = cleanText(track.artist || "").split("/")[0].trim();
  if (title) return `《${title}》`;
  if (artist) return `${artist}这首歌`;
  return "这首歌";
}

function buildSongNoun(track, frame) {
  const title = cleanText(track.title || "");
  const artist = cleanText(track.artist || "").split("/")[0].trim();
  const texture = [frame.genre, frame.secondGenre].filter(Boolean).join("和") || "这首歌";
  const scene = frame.scene || frame.secondScene || "";
  const mood = frame.mood || frame.secondMood || "";
  if (title && artist) return `《${title}》这首由${artist}唱出来的${texture}`;
  if (title) return `《${title}》这首${texture}`;
  return `${scene || mood ? `${scene}${mood}` : "这首歌"}的质感`;
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

function buildOpeningOptions(frame, archetype, songCue) {
  const byArchetype = {
    "rnb-close": [
      `${songCue}R&B 的入口可以先放近一点。人刚离开白天的噪声，低频比大道理更管用。`,
      `${songCue}不要把它当成普通情歌听。它更像下班后手机屏幕暗下来的那几秒，人终于能听见自己。`,
      `${songCue}郑重的话先不说。让人声和节拍靠近一点，今天那些没处理完的事先退到后面。`
    ],
    "quiet-companion": [
      `${songCue}先按${frame.genre || "编曲"}和${frame.scene || "夜里"}这两个点听，歌手的声音比空泛安慰更具体。`,
      `${songCue}听起来不抢人。放在回家路上，它像把白天的声音往后推了一步。`,
      `${songCue}不用开很大声。它的好处是靠近，而不是把今晚说成一个结论。`
    ],
    "bright-pop": [
      `${songCue}会把车窗外的灯推亮一点。不是鸡血，就是让疲惫别一直闷在胸口。`,
      `${songCue}让心情抬头看一眼。像走出地铁口那一下，空气忽然松了一点。`,
      `${songCue}像开一扇小窗。不用太热闹，只要有一点亮色，就够把路上的沉闷擦掉。`
    ],
    "emotional-hold": [
      `${songCue}会把情绪放到台面上，但不把话说重。像包里那张皱掉的小票，先放着也没关系。`,
      `${songCue}不给答案，先给情绪一个边界。人累的时候，最怕别人急着替你总结。`,
      `${songCue}适合放在有点低落的时候。很多事不是想明白才过去，是先给自己几分钟缓一缓。`
    ],
    "moving-scene": [
      `${songCue}很适合路上这段空白。身体在移动，脑子还留在刚才那个房间，先让声音陪你过桥。`,
      `${songCue}放在等红灯或等地铁的时候刚好。让节奏先往前走一点，人就不用一直卡在白天。`,
      `${songCue}像公司到家之间的缓冲带。先别急着切换身份，音乐会替你走一段。`
    ],
    "steady-pop": [
      `${songCue}先稳一点，不把情绪推高，也不让它掉下去。像把桌面清出一角，给自己留个能放杯子的地方。`,
      `${songCue}不是靠惊喜取胜，是让人没有负担地继续听下去。这里少说一点，把位置让给音乐。`,
      `${songCue}拍子比较平，不会突然把气氛推高。现在先从这首开始，让耳朵有个清楚的入口。`
    ]
  };
  return byArchetype[archetype] || byArchetype["steady-pop"];
}

function buildBridgeOneOptions(frame, archetype, songNoun) {
  return [
    `${songNoun}的入口不复杂：${frame.genre || "编曲"}、${frame.scene || "这一段"}，再加一点人声里的停顿，就够把场景立起来。`,
    `听${songNoun}的时候，可以先抓住${frame.genre || "编曲"}里比较清楚的那条线。它会让白天那堆声音往后退一点。`,
    frame.secondGenre
      ? `${frame.secondGenre}里那点轻微的摆动很有用，不会抢路上的注意力，也不会把情绪往下拽。`
      : `${songNoun}的编排不急着把情绪推满，适合放在这一段路上，让人慢慢把注意力收回来。`,
    archetype === "emotional-hold"
      ? `如果心里还有一点堵，先别把它讲成故事。跟着这首听完，比急着解释更轻松。`
      : `这种时候，歌不用说太满。把音量放到刚好能盖住路噪的位置，就可以了。`
  ];
}

function buildBridgeTwoOptions(frame, archetype) {
  return [
    `再往后听，就把注意力从白天那些细碎任务里拿回来一点。消息可以晚点回，表情也不用一直撑着。`,
    `有句老话说，不如意事常八九。听起来很旧，但有时候旧话管用，因为它允许人今天先不完美。`,
    frame.hook,
    archetype === "rnb-close"
      ? `等节拍再往前走一点，人会没那么绷。这个变化不用说大，听得到就行。`
      : `我们不把话说满。剩下的部分留给歌曲本身，你不用急着把今晚整理出一个结论。`
  ];
}

function buildNextTease(track, nextTrack, context = {}) {
  if (!nextTrack) {
  return chooseLine([
    `这首后半段就留给音乐。等它收住，我再按你刚才说的方向继续排。`,
    `后面不急着换话题，让这首歌自己收完整。下一段继续按歌名、歌手和评论故事来接。`,
    `到这里先不再补话。等这首走完，再接下一首可播的歌。`
    ], `${track.id}:final-tease`, context.query || "");
  }

  const nextFrame = buildSongFrame(nextTrack, cleanText(context.query || ""));
  const relation = pickRelation(track, nextTrack);
  const nextFocus = pickNextFocus(relation, nextFrame, nextTrack);
  return chooseLine([
    `等《${track.title}》收住，下一首《${nextTrack.title}》会从${relation}接到${nextFocus}。`,
    `待会儿接到《${nextTrack.title}》时，重点换到${nextFocus}，队列不会只停在同一种说法里。`,
    `《${nextTrack.title}》后面接上来，歌手和${nextFrame.genre || nextFrame.scene || "场景"}会给这组歌换一个具体入口。`,
    `后面会接《${nextTrack.title}》。我会把话题从《${track.title}》的${relation}，挪到${nextFocus}。`
  ], `${track.id}:next:${nextTrack.id}`, context.query || "");
}

function pickNextFocus(relation, nextFrame = {}, nextTrack = {}) {
  const candidates = [
    nextFrame.scene,
    nextFrame.genre,
    nextFrame.secondMood,
    cleanText(nextTrack.artist || "").split("/")[0].trim()
  ].filter(Boolean);
  return candidates.find((item) => item && !relation.includes(item) && item !== "情绪") || "下一首的歌手和场景";
}

function buildClosing(track, nextTrack, context = {}) {
  if (nextTrack) return `从《${track.title}》到《${nextTrack.title}》，下一段换到歌手、曲风和评论素材来接。`;
  return chooseLine([
    "这一段到这里就够了，留一点余味给后面的歌。",
    "剩下的路让音乐自己走，Claudio 会继续在旁边。",
    "今晚不用一次想清楚，听完这一首，再看下一首怎么接。"
  ], `${track.id}:closing`, context.query || "");
}

function pickRelation(track, nextTrack) {
  const sharedMood = firstSharedValue(track.moods, nextTrack.moods);
  if (sharedMood) return sharedMood === "情绪" ? `《${cleanText(track.title || "上一首")}》里的情绪` : `${sharedMood}的状态`;
  const sharedScene = firstSharedValue(track.scenes, nextTrack.scenes);
  if (sharedScene) return `${sharedScene}的场景`;
  const sharedGenre = firstSharedValue(track.genres, nextTrack.genres);
  if (sharedGenre) return `${sharedGenre}的质感`;
  return `《${cleanText(track.title || "上一首")}》这一段`;
}

function buildSlotCue(query, queueIndex) {
  if (queueIndex <= 0) return buildQueryLine(query);
  return chooseLine([
    "这一首换到歌手和曲风，",
    "这一首从评论或故事切入，",
    "这一首把城市资讯放轻一点，",
    "这一首用歌曲本身接上，",
    "这一首不重复前面的场景，",
    "这一首把重点放回歌名和声音，",
    "这一首换到下一层素材，",
    "这一首接住队列里的另一个角度，"
  ], `slot:${queueIndex}:${query}`, `${queueIndex}:${query}`);
}

function buildQueryLine(query) {
  if (!query) return "先把节奏调稳。";
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
    return "你现在更需要安静一点的歌，";
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
      "这类温柔不用哄人，主要是不会催你。放在耳机里，适合把步子慢下来一点。",
      "它的声音边缘比较软，不会把情绪往下压，听起来更像陪你走完这一段路。"
    ],
    "安静": [
      "安静不是没有声音，是这首歌没有催你反应。你可以只听，不用马上给出态度。",
      "把外面的动静调小一点，耳机里的节奏会更清楚。"
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

function sanitizeTalkCopy(value = "") {
  return tidyPunctuation(cleanText(value)
    .replace(/把频道稍微拨暗一点/g, "这里换一个更稳的速度")
    .replace(/先把频道调稳/g, "先把节奏调稳")
    .replace(/这一首负责把气口接住/g, "这一首先把节奏稳住")
    .replace(/气口/g, "节奏")
    .replace(/情绪路线/g, "这组歌")
    .replace(/情绪换了一口气/g, "下一首换到新的歌手和素材")
    .replace(/情绪换一口气/g, "下一首换到新的歌手和素材")
    .replace(/换一种情绪/g, "换到下一首的歌手和素材")
    .replace(/不急着往前走/g, "先把当前这首听完整")
    .replace(/还挂在北京的夜晚里/g, "继续放在北京夜里的节目里")
    .replace(/他说，评论里那一句，?/g, "")
    .replace(/这比单纯的介绍更像一个真实入口/g, "这句评论可以把歌里的关系说得更具体")
    .replace(/这比单纯介绍《([^》]+)》更像一个真实入口/g, "这句评论可以把《$1》说得更具体")
    .replace(/主线/g, "线索")
    .replace(/慢慢听/g, "先听这首")
    .replace(/很稳/g, "比较顺")
    .replace(/接住/g, "接上")
    .replace(/往下走/g, "继续排")
    .replace(/继续往前/g, "继续排")
    .replace(/继续往下走/g, "接到下一首")
    .replace(/继续往回走/g, "把下一首接到具体的歌名和场景上")
    .replace(/风突然换了方向/g, "下一首会换到另一组歌手和场景")
    .replace(/风换了方向/g, "下一首会换到另一组歌手和场景")
    .replace(/风里多了一点胡同的味道/g, "下一首会把歌手和故事换一个角度")
    .replace(/不急着安慰人，只把声音放到一个舒服的位置/g, "不急着讲道理，只把音量放轻一点")
    .replace(/不负责劝人，只负责别太用力地陪着/g, "不急着讲道理，也不把情绪推得太满")
    .replace(/先把音量放轻，让这几分钟像一盏不刺眼的灯/g, "先把音量放轻，让这几分钟留给自己")
    .replace(/像一盏不刺眼的灯/g, "像一段不打扰人的路")
    .replace(/换一束侧光进来/g, "换一个角度听")
    .replace(/把声音放到一个舒服的位置/g, "把音量放轻一点")
    .replace(/负责把/g, "先把"));
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

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickBySeed(items = [], seedText = "") {
  if (!items.length) return null;
  return items[hashText(seedText) % items.length];
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}
