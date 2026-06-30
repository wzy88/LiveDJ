import { buildTalkVoiceProfile } from "./talk-voice.js";

export function buildTrackContentPack({ track = {}, brief = {}, songContext = {}, artistContext = {}, broadcastContext = {}, previousTrack = null, nextTrack = null } = {}) {
  return {
    songFacts: {
      title: cleanText(track.title || ""),
      artist: cleanText(track.artist || ""),
      moods: values(track.moods).slice(0, 3),
      scenes: values(track.scenes).slice(0, 3),
      genres: values(track.genres).slice(0, 3),
      evidence: (track.evidence || []).map(cleanText).filter(Boolean).slice(0, 4)
    },
    programSlot: cleanText(track.programSlot || ""),
    programSlotLabel: cleanText(track.programSlotLabel || ""),
    selectionReason: cleanText(track.programReason || buildSelectionReason(track, brief)),
    story: {
      provider: cleanText(songContext.provider || ""),
      hotCommentThemes: (songContext.hotCommentThemes || []).map(cleanText).filter(Boolean).slice(0, 3),
      commentExcerpts: normalizeCommentExcerpts(songContext.commentExcerpts),
      storySummary: cleanText(songContext.storySummary || ""),
      confidence: songContext.storySummary || songContext.hotCommentThemes?.length || songContext.commentExcerpts?.length ? "fetched-or-summarized" : "empty"
    },
    artist: {
      provider: cleanText(artistContext.provider || ""),
      name: cleanText(artistContext.name || track.artist || ""),
      brief: cleanText(artistContext.brief || ""),
      facts: (artistContext.facts || []).map(cleanText).filter(Boolean).slice(0, 3)
    },
    editorial: {
      city: cleanText(broadcastContext.city || brief.city || "北京"),
      timeCue: cleanText(broadcastContext.timeCue || ""),
      localSceneSummary: cleanText(broadcastContext.localSceneSummary || ""),
      newsBriefs: briefTexts(broadcastContext.newsBriefs),
      cultureBriefs: briefTexts(broadcastContext.cultureBriefs),
      editorialAngles: (broadcastContext.editorialAngles || []).map(cleanText).filter(Boolean).slice(0, 4)
    },
    transitionRole: buildTransitionRole({ track, previousTrack, nextTrack })
  };
}

export function buildShowTalkPlan({ brief = {}, packs = [] } = {}) {
  const voiceProfile = buildTalkVoiceProfile(brief);
  return {
    showThesis: buildShowThesis(brief),
    tone: "城市编辑型，但像朋友在旁边说话",
    voiceProfile,
    recurringMotifs: buildRecurringMotifs(brief),
    avoidPhrases: ["今晚这一段", "不把话说满", "放慢一点", "适合今晚", "这首歌很适合你", "私人时间", "自留地"],
    tracks: (packs || []).map((pack, index) => ({
      title: pack.songFacts?.title || "",
      slot: pack.programSlot || "",
      talkAngle: buildTalkAngle(pack, index),
      selectionReason: pack.selectionReason || ""
    }))
  };
}

function buildSelectionReason(track = {}, brief = {}) {
  const facts = [
    values(track.scenes)[0],
    values(track.moods)[0],
    values(track.genres)[0]
  ].filter(Boolean).join("、");
  if (brief.format === "city-editorial") {
    return facts ? `这首歌能把${brief.city || "城市"}语境和${facts}接起来` : `这首歌适合作为城市编辑型节目的素材`;
  }
  return facts ? `这首歌和这次输入里的${facts}贴近` : "这首歌适合接在当前节目里";
}

function buildShowThesis(brief = {}) {
  if (brief.format === "city-editorial") {
    const city = brief.city || "北京";
    const scene = brief.scene || defaultSceneForTimeIntent(brief.timeIntent);
    const motif = motifForTimeIntent(brief.timeIntent, city);
    return `这是一档关于${city}${scene}的城市编辑节目：用歌、评论故事和一点资讯，把${motif}串起来。`;
  }
  return "这是一档按当前状态排歌的节目：先说清楚为什么放这首，再让歌曲自然往后接。";
}

function buildTalkAngle(pack = {}, index) {
  if (pack.programSlot === "story") return "把热评、听众故事和歌曲本身连起来，但不复述原评论。";
  if (pack.programSlot === "city") return "把城市资讯、夜间生活和歌曲场景连起来，点到为止。";
  if (pack.programSlot === "opener") return "用开场歌迅速建立这期节目的城市和情绪入口。";
  if (pack.programSlot === "closer") return "把前面的故事和城市感收住，留出余味。";
  return index > 0 ? "让节目换一个歌曲角度，避免队列平铺。" : "建立节目入口。";
}

function buildRecurringMotifs(brief = {}) {
  const city = brief.city || "北京";
  const scene = brief.scene || defaultSceneForTimeIntent(brief.timeIntent);
  if (brief.format === "city-editorial") {
    return motifsForTimeIntent(brief.timeIntent, city, scene);
  }
  return ["用户这次点名的歌手或曲风", "歌曲本身的场景和心情", "下一首如何接上当前这首"];
}

function defaultSceneForTimeIntent(timeIntent = "") {
  if (timeIntent === "morning") return "上午工作间隙";
  if (timeIntent === "noon") return "午间休息";
  if (timeIntent === "afternoon") return "下午工作间隙";
  if (timeIntent === "late-night") return "深夜放松";
  if (timeIntent === "evening") return "晚上回家路上";
  return "此刻";
}

function motifForTimeIntent(timeIntent = "", city = "北京") {
  if (timeIntent === "morning") return "写字楼、咖啡和会议间隙";
  if (timeIntent === "noon") return "午间街面、外卖和短暂空下来的耳朵";
  if (timeIntent === "afternoon") return "下午任务、屏幕疲劳和快到傍晚的出口";
  if (timeIntent === "late-night") return "路灯、便利店和深夜还没放下的话";
  if (timeIntent === "evening") return "地铁口、环路和下班后的几分钟";
  return `${city}此刻的街面、信息流和耳机里的几分钟`;
}

function motifsForTimeIntent(timeIntent = "", city = "北京", scene = "此刻") {
  if (timeIntent === "morning") {
    return [`${city}${scene}的写字楼和咖啡`, "评论里的告别、遗憾或重逢", "上午几分钟的真实资讯背景"];
  }
  if (timeIntent === "noon") {
    return [`${city}${scene}的外卖、咖啡和街面`, "评论里的告别、遗憾或重逢", "午间几分钟的真实资讯背景"];
  }
  if (timeIntent === "afternoon") {
    return [`${city}${scene}的屏幕和写字楼玻璃`, "评论里的告别、遗憾或重逢", "下午几分钟的真实资讯背景"];
  }
  if (timeIntent === "late-night") {
    return [`${city}${scene}的路灯和便利店`, "评论里的告别、遗憾或重逢", "深夜几分钟的真实资讯背景"];
  }
  return [`${city}${scene}的地铁口和环路`, "评论里的告别、遗憾或重逢", "下班后几分钟的真实资讯背景"];
}

function buildTransitionRole({ track = {}, previousTrack = null, nextTrack = null } = {}) {
  const title = cleanText(track.title || "这首歌");
  const previous = previousTrack?.title ? `从《${previousTrack.title}》` : "从前一首";
  const next = nextTrack?.title ? `接到《${nextTrack.title}》` : "往后留一点余味";
  const previousMood = values(previousTrack?.moods)[0] || "";
  const nextMood = values(nextTrack?.moods)[0] || "";
  const moodBridge = [previousMood, nextMood].filter(Boolean).join("到");
  return `${previous}转到《${title}》，再${next}${moodBridge ? `，情绪从${moodBridge}之间换气` : ""}`;
}

function values(items = []) {
  return (items || []).map((item) => cleanText(item?.value || item)).filter(Boolean);
}

function briefTexts(items = []) {
  return (items || [])
    .map((item) => cleanText(typeof item === "string" ? item : item?.text || ""))
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeCommentExcerpts(items = []) {
  return (items || [])
    .map((item) => ({
      text: cleanText(typeof item === "string" ? item : item?.text || ""),
      theme: cleanText(typeof item === "string" ? "" : item?.theme || ""),
      source: cleanText(typeof item === "string" ? "netease-hot-comment" : item?.source || "netease-hot-comment")
    }))
    .filter((item) => item.text)
    .slice(0, 4);
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}
