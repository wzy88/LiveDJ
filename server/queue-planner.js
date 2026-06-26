const CITY_EDITORIAL_SLOTS = [
  { id: "opener", label: "开场", reason: "先贴住这次输入的状态，让节目马上成立" },
  { id: "story", label: "故事段", reason: "这一首更适合承接热评、故事和私人记忆" },
  { id: "turn", label: "转向", reason: "给节目换一个角度，避免情绪一直停在同一层" },
  { id: "city", label: "城市段", reason: "这一首方便接入城市资讯、夜间生活和北京语境" },
  { id: "relief", label: "松口气", reason: "在信息和故事之后，让听感稍微松开一点" },
  { id: "closer", label: "收尾", reason: "给这期节目留出余味，不突然断掉" }
];

export function planRadioQueue({ candidates = [], brief = {}, limit = 6 } = {}) {
  const pool = [...(candidates || [])].filter(Boolean);
  const planned = [];
  const targetLimit = Math.max(0, Number(limit) || 0);
  const slots = buildSlots(brief, targetLimit);

  for (const slot of slots) {
    if (!pool.length || planned.length >= targetLimit) break;
    const index = bestCandidateIndex(pool, slot, planned, brief);
    const [picked] = pool.splice(index, 1);
    planned.push({
      ...picked,
      programSlot: slot.id,
      programSlotLabel: slot.label,
      programReason: buildProgramReason(picked, slot, brief)
    });
  }

  return planned;
}

function buildSlots(brief = {}, limit) {
  const base = brief.format === "city-editorial" ? CITY_EDITORIAL_SLOTS : CITY_EDITORIAL_SLOTS.slice(0, 3);
  if (limit <= base.length) {
    if (limit <= 1) return base.slice(0, 1);
    if (limit === 2) return [base[0], base[1]];
    if (limit === 3) return [base[0], base[1], base[base.length - 1]];
    return [...base.slice(0, limit - 1), base[base.length - 1]];
  }
  const result = [...base];
  while (result.length < limit) {
    result.push({
      id: `deep-${result.length - base.length + 1}`,
      label: "延展",
      reason: "继续扩展这期节目的城市和故事线"
    });
  }
  return result;
}

function bestCandidateIndex(pool, slot, planned, brief) {
  let bestIndex = 0;
  let bestScore = -Infinity;
  for (let index = 0; index < pool.length; index += 1) {
    const candidate = pool[index];
    const score = scoreCandidateForSlot(candidate, slot, planned, brief);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function scoreCandidateForSlot(track, slot, planned, brief) {
  let score = Number(track.recommendScore) || 0;
  if (hasExplicitEvidence(track)) score += slot.id === "opener" ? 400 : 120;
  if (slot.id === "story") score += storyScore(track);
  if (slot.id === "city") score += cityScore(track, brief);
  if (slot.id === "turn") score += turnScore(track, planned);
  if (slot.id === "relief") score += reliefScore(track);
  if (slot.id === "closer") score += closerScore(track);
  score -= repeatArtistPenalty(track, planned);
  score -= repeatLeadMoodPenalty(track, planned, brief);
  score -= slotMoodPenalty(track, slot, planned, brief);
  return score;
}

function buildProgramReason(track, slot, brief) {
  const parts = [slot.reason];
  if (hasExplicitEvidence(track)) parts.unshift("用户这次点名相关，优先放进节目");
  if (slot.id === "story" || storyScore(track) > 24) parts.push("它有可讲的评论/故事角度");
  if (slot.id === "city" || cityScore(track, brief) > 20) parts.push(`${brief.city || "城市"}语境能自然接上`);
  return parts.join("；");
}

function hasExplicitEvidence(track = {}) {
  return (track.evidence || []).some((item) => String(item).includes("这次点名想听"));
}

function storyScore(track = {}) {
  const haystack = valuesText(track);
  let score = 0;
  if (/(故事|热评|评论|私人|告别|遗憾|青春|关系)/.test(`${haystack} ${(track.evidence || []).join(" ")}`)) score += 70;
  if (/(民谣|流行|华语)/.test(haystack)) score += 12;
  if (/(温柔|有故事|情绪|安静)/.test(haystack)) score += 18;
  return score;
}

function cityScore(track = {}, brief = {}) {
  const haystack = valuesText(track);
  let score = 0;
  if (brief.city && haystack.includes(brief.city)) score += 80;
  if (/(北京|城市|夜晚|通勤|路上|回家|散步|深夜)/.test(haystack)) score += 50;
  if (/(R&B|流行|民谣)/i.test(haystack)) score += 8;
  return score;
}

function turnScore(track = {}, planned = []) {
  const previous = planned[planned.length - 1];
  if (!previous) return 0;
  let score = 0;
  if (leadMood(track) && leadMood(track) !== leadMood(previous)) score += 34;
  if (leadGenre(track) && leadGenre(track) !== leadGenre(previous)) score += 24;
  if (/(明亮|松弛|温柔)/.test(leadMood(track))) score += 12;
  return score;
}

function reliefScore(track = {}) {
  const text = valuesText(track);
  if (/(明亮|松弛|温柔|治愈|轻快)/.test(text)) return 46;
  if (/(情绪|伤感|emo|失恋)/i.test(text)) return -28;
  return 0;
}

function closerScore(track = {}) {
  const text = valuesText(track);
  if (/(安静|温柔|深夜|民谣|有故事)/.test(text)) return 42;
  return 8;
}

function repeatArtistPenalty(track, planned) {
  const artist = primaryArtist(track.artist);
  if (!artist) return 0;
  return planned.some((item) => primaryArtist(item.artist) === artist) ? 150 : 0;
}

function repeatLeadMoodPenalty(track, planned, brief = {}) {
  const mood = leadMood(track);
  if (!mood) return 0;
  const repeats = planned.filter((item) => leadMood(item) === mood).length;
  if (!repeats) return 0;
  if (brief.format === "city-editorial") return repeats * 140;
  return repeats * 36;
}

function slotMoodPenalty(track, slot, planned, brief = {}) {
  if (brief.format !== "city-editorial") return 0;
  const mood = leadMood(track);
  if (!mood) return 0;
  if (slot.id === "turn" && planned.some((item) => leadMood(item) === mood)) return 80;
  if (slot.id === "relief" && /(情绪|伤感|emo|失恋)/i.test(mood)) return 180;
  if (slot.id === "city" && planned.length >= 3 && planned.filter((item) => leadMood(item) === mood).length >= 1) return 120;
  return 0;
}

function valuesText(track = {}) {
  return [
    track.title,
    track.artist,
    ...(track.moods || []).map((item) => item.value),
    ...(track.scenes || []).map((item) => item.value),
    ...(track.genres || []).map((item) => item.value)
  ].filter(Boolean).join(" ");
}

function leadMood(track = {}) {
  return track.moods?.[0]?.value || "";
}

function leadGenre(track = {}) {
  return track.genres?.[1]?.value || track.genres?.[0]?.value || "";
}

function primaryArtist(value = "") {
  return String(value).split(/[\/,&，、]/)[0].trim().toLowerCase();
}
