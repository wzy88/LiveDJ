export function buildTalkBrief({
  query = "",
  queueIndex = 0,
  track = {},
  nextTrack = null,
  brief = {},
  contentPack = {},
  broadcastContext = {},
  programClock = null
} = {}) {
  const userKeywords = buildUserKeywords({ query, brief, track, contentPack, broadcastContext });
  const currentTrack = buildCurrentTrackBrief(track, contentPack);
  const rawMaterials = buildMaterials({ contentPack, broadcastContext });
  const primaryAngle = pickPrimaryAngle({ userKeywords, materials: rawMaterials, contentPack, queueIndex });
  const talkStrategy = pickTalkStrategy({ query, userKeywords, materials: rawMaterials, contentPack, currentTrack, brief });
  const materials = suppressStoryForSceneFirst({ talkStrategy, brief })
    ? compactObject({ ...rawMaterials, story: "" })
    : rawMaterials;
  const sceneFirst = talkStrategy === "scene_first";
  const normalizedProgramClock = normalizeProgramClock(programClock);
  const programClockTask = normalizedProgramClock?.writingInstruction
    ? `当前节目钟角色是“${normalizedProgramClock.label || normalizedProgramClock.role}”：${normalizedProgramClock.writingInstruction}`
    : "";
  const mustMention = uniqueClean([
    ...userKeywords.artists,
    ...userKeywords.city,
    ...userKeywords.scene.slice(0, 2),
    ...userKeywords.mood.slice(0, 2),
    currentTrack.title,
    currentTrack.artist
  ]).slice(0, 8);
  const bannedPhrases = uniqueClean([
    "今晚的情绪路线很稳",
    "慢慢听",
    "很稳",
    "气口",
    "主线",
    "接住",
    "往下走",
    "私人电台质感",
    "别让同一段城市背景抢走音乐",
    "这一次把北京背景收轻一点",
    "这首先不再重复城市开场",
    ...(brief.avoidPhrases || []),
    ...(contentPack.voiceProfile?.bannedPhrases || [])
  ]).slice(0, 16);

  return compactObject({
    purpose: queueIndex <= 0 ? "节目开场口播" : "节目中段串联口播",
    programFunction: sceneFirst ? "companion_scene_progression" : "answer_why_this_song_now",
    primaryAngle,
    talkStrategy,
    programClock: normalizedProgramClock,
    requiredMaterials: sceneFirst
      ? ["user_scene", "current_track", "light_music_cue"]
      : ["user_scene", "song_reason", "current_track", "concrete_material"],
    segmentJobs: sceneFirst ? {
      opening: "用用户状态、动作、时间或声音感受开口；不要报幕，不要默认写歌名或歌手。",
      bridge: "推进场景里的动作、身体、目标或环境；音乐只点到一两次，不要反复证明歌曲适合场景。",
      nextTease: "轻轻把当前状态接到下一首，不要解释推荐逻辑，不要只报歌名。"
    } : {
      opening: "用用户场景、动作、时间或声音感受开口；必要时再用歌名、歌手或素材锚定当前歌曲。",
      bridge: "使用一个具体素材做节目判断：说明这首歌为什么适合此刻，而不是复述资料。",
      nextTease: "如果有下一首，解释它和当前歌曲如何接上，不能只报歌名。"
    },
    userKeywords,
    currentTrack,
    nextTrack: nextTrack ? compactObject({
      title: cleanText(nextTrack.title || ""),
      artist: cleanText(nextTrack.artist || ""),
      role: "用于自然预告下一首，不能像报幕"
    }) : null,
    materials,
    writingTask: sceneFirst
      ? ["写一段200-300字以内的中文电台口播，核心任务是陪用户经历这个时刻。场景是底色，歌曲是背景，不要把口播写成歌曲适配说明。用动作、身体感、环境、目标和留白推进；音乐只点到一两次，不要空泛，不要主持腔，不要编造输入里没有的事实。", programClockTask].filter(Boolean).join(" ")
      : ["写一段200-300字以内的中文电台口播，核心任务是回答“为什么此刻放这首歌”。必须融合用户命题、当前歌曲、可用热评/故事、歌手信息、天气/新闻/娱乐八卦等素材；不要空泛，不要主持腔，不要编造输入里没有的事实。", programClockTask].filter(Boolean).join(" "),
    qualityGate: sceneFirst ? [
      "必须陪用户经历当前场景，而不是证明歌曲适合场景",
      "场景是底色，不要每段都解释音乐和场景的匹配",
      "音乐只点到一两次，其余用动作、身体感、环境或目标推进",
      "不要复读用户场景词，要转成时间、动作、身体感或环境画面",
      "不满足以上条件必须拒稿重写"
    ] : [
      "必须回答为什么此刻放这首歌",
      "必须同时覆盖用户诉求、当前歌曲和至少一个具体素材",
      "不要复读用户场景词，要转成时间、动作、身体感或环境画面",
      "只提到素材但没有形成节目判断视为失败",
      "不满足以上条件必须拒稿重写"
    ],
    mustMention,
    bannedPhrases
  });
}

function normalizeProgramClock(programClock = null) {
  if (!programClock || typeof programClock !== "object") return null;
  return compactObject({
    role: cleanText(programClock.role || ""),
    label: cleanText(programClock.label || ""),
    playedFields: (programClock.playedFields || []).map(cleanText).filter(Boolean),
    writingInstruction: cleanText(programClock.writingInstruction || "")
  });
}

function suppressStoryForSceneFirst({ talkStrategy = "", brief = {} } = {}) {
  return talkStrategy === "scene_first" && !(brief.contentTaste || []).length;
}

function pickTalkStrategy({ query = "", userKeywords = {}, materials = {}, contentPack = {}, currentTrack = {}, brief = {} } = {}) {
  const text = cleanText(query);
  const hasNamedMusic = Boolean(userKeywords.explicitArtists?.length) ||
    Boolean(currentTrack.title && text.includes(currentTrack.title));
  const hasRequestedStory = (brief.contentTaste || []).some((item) => ["stories", "hot-comments"].includes(item));
  const hasRequestedEditorial = Boolean(brief.city || (brief.contentTaste || []).some((item) => ["news", "gossip"].includes(item)));
  const hasRequestedArtistMaterial = hasNamedMusic || (brief.contentTaste || []).includes("gossip");
  const hasExternalMaterial = Boolean((hasRequestedStory && materials.story) || (hasRequestedArtistMaterial && materials.artist) || (hasRequestedEditorial && materials.cityEditorial));
  const hasExplicitSongReason = Boolean(cleanText(contentPack.selectionReason || contentPack.programReason || ""));
  const hasExplicitMusicTaste = Boolean((brief.musicTaste?.eras || []).length || (brief.musicTaste?.energy || []).length);
  if (!hasNamedMusic && !hasExternalMaterial && !hasExplicitMusicTaste && brief.format === "personal-companion") return "scene_first";
  if (!hasNamedMusic && !hasExternalMaterial && !hasExplicitSongReason) return "scene_first";
  return "material_anchored";
}

function pickPrimaryAngle({ userKeywords = {}, materials = {}, contentPack = {}, queueIndex = 0 } = {}) {
  if (queueIndex <= 0 && (userKeywords.scene?.length || userKeywords.mood?.length)) return "user_scene";
  if (materials.story) return "comment_story";
  if (materials.songResearch) return "song_research";
  if (materials.artist) return "artist_context";
  if (materials.cityEditorial) return "city_editorial";
  if (contentPack.transitionRole) return "transition";
  return "song_reason";
}

function buildUserKeywords({ query = "", brief = {}, track = {}, contentPack = {}, broadcastContext = {} } = {}) {
  const text = cleanText(query);
  const artist = primaryArtist(track.artist || contentPack.artist?.name || "");
  const explicitArtists = extractKnownArtists(text, artist);
  return {
    explicitArtists,
    artists: uniqueClean([
      ...explicitArtists,
      artist
    ]).slice(0, 4),
    city: uniqueClean([extractCity(text), brief.city, broadcastContext.city, contentPack.editorial?.city]).slice(0, 3),
    scene: uniqueClean([
      ...extractScenes(text),
      brief.scene,
      ...values(track.scenes).slice(0, 2)
    ]).slice(0, 5),
    mood: uniqueClean([
      ...extractMoods(text),
      ...(brief.mood || []),
      ...values(track.moods).slice(0, 2)
    ]).slice(0, 5),
    content: uniqueClean([
      ...extractContentNeeds(text),
      ...(brief.contentTaste || []).map(contentTasteLabel),
      ...(brief.musicTaste?.eras || []),
      ...(brief.musicTaste?.energy || []),
      ...(brief.useCase || [])
    ]).slice(0, 8)
  };
}

function buildCurrentTrackBrief(track = {}, contentPack = {}) {
  const title = cleanText(track.title || contentPack.songFacts?.title || "");
  const artist = cleanText(track.artist || contentPack.songFacts?.artist || "");
  const scenes = values(track.scenes || contentPack.songFacts?.scenes).slice(0, 3);
  const moods = values(track.moods || contentPack.songFacts?.moods).slice(0, 3);
  const genres = values(track.genres || contentPack.songFacts?.genres).slice(0, 3);
  const selectionReason = cleanText(contentPack.selectionReason || track.programReason || "");
  const materialSummary = [
    title ? `《${title}》` : "",
    artist,
    [...scenes, ...moods, ...genres].join("、"),
    selectionReason
  ].filter(Boolean).join("；");
  return compactObject({
    title,
    artist,
    scenes,
    moods,
    genres,
    selectionReason,
    materialSummary
  });
}

function buildMaterials({ contentPack = {}, broadcastContext = {} } = {}) {
  const storyParts = [
    cleanText(contentPack.story?.storySummary || ""),
    ...(contentPack.story?.hotCommentThemes || []).map((item) => `热评主题：${cleanText(item)}`),
    ...(contentPack.story?.commentExcerpts || []).map((item) => `评论里有一句：${cleanText(typeof item === "string" ? item : item?.text || "")}`)
  ].filter(Boolean);
  const artistParts = [
    cleanText(contentPack.artist?.brief || ""),
    ...(contentPack.artist?.facts || []).map(cleanText)
  ].filter(Boolean);
  const researchParts = [
    ...(contentPack.research?.audibleCues || []).map((item) => `听感：${cleanText(item)}`),
    ...(contentPack.research?.listenerAngles || []).map((item) => `听众场景：${cleanText(item)}`),
    ...(contentPack.research?.talkSeeds || []).map((item) => `口播种子：${cleanText(item)}`),
    ...(contentPack.research?.backgroundFacts || []).map((item) => `公开资料：${cleanText(item)}`)
  ].filter(Boolean);
  const cityParts = [
    cleanText(broadcastContext.timeCue || contentPack.editorial?.timeCue || ""),
    cleanText(broadcastContext.city || contentPack.editorial?.city || ""),
    cleanText(broadcastContext.weatherSummary || ""),
    cleanText(broadcastContext.localSceneSummary || contentPack.editorial?.localSceneSummary || ""),
    ...briefTexts(broadcastContext.newsBriefs || contentPack.editorial?.newsBriefs).map((item) => `新闻/资讯：${item}`),
    ...briefTexts(broadcastContext.cultureBriefs || contentPack.editorial?.cultureBriefs).map((item) => `娱乐/文化：${item}`),
    ...((broadcastContext.editorialAngles || contentPack.editorial?.editorialAngles || []).map((item) => `编辑角度：${cleanText(item)}`))
  ].filter(Boolean);
  return compactObject({
    story: storyParts.join(" "),
    artist: artistParts.join(" "),
    songResearch: researchParts.join(" "),
    cityEditorial: cityParts.join(" ")
  });
}

function extractKnownArtists(text = "", fallbackArtist = "") {
  const result = [];
  const clean = cleanText(text);
  for (const name of ["凤凰传奇", "李宗盛", "陈奕迅", "周杰伦", "五月天", "Beyond", "陈绮贞", "孙燕姿", "王菲", "赵雷"]) {
    if (clean.includes(name)) result.push(name);
  }
  if (fallbackArtist && clean.includes(fallbackArtist)) result.push(fallbackArtist);
  return result;
}

function extractCity(text = "") {
  if (/北京/.test(text)) return "北京";
  if (/上海/.test(text)) return "上海";
  if (/广州/.test(text)) return "广州";
  if (/深圳/.test(text)) return "深圳";
  return "";
}

function extractScenes(text = "") {
  const scenes = [];
  if (/开车|驾驶|车里|方向盘/.test(text)) scenes.push("开车");
  if (/骑自行车|自行车|骑车|骑行|单车|公路车|山地车/.test(text)) scenes.push("骑行");
  if (/通勤|地铁|公交|路上/.test(text)) scenes.push("通勤路上");
  if (/回家|下班|晚高峰/.test(text)) scenes.push("回家路上");
  if (/办公|办公室|工作|学习|写东西|处理任务|加班/.test(text)) scenes.push("工作学习");
  if (/睡前|失眠/.test(text)) scenes.push("睡前");
  return scenes;
}

function extractMoods(text = "") {
  const moods = [];
  if (/犯困|困|提神|醒|防困/.test(text)) moods.push("犯困", "提神");
  if (/节奏感|节奏强|带劲|动感|律动/.test(text)) moods.push("节奏感");
  if (/骑自行车|自行车|骑车|骑行|单车|公里|km|KM|Km/.test(text)) moods.push("节奏感");
  if (/轻松|松弛|陪伴/.test(text)) moods.push("轻松陪伴");
  if (/开心|热闹|有劲/.test(text)) moods.push("明亮");
  if (/emo|难过|低落/.test(text)) moods.push("情绪");
  return moods;
}

function extractContentNeeds(text = "") {
  const needs = [];
  if (/天气/.test(text)) needs.push("天气");
  if (/新闻|资讯|热点/.test(text)) needs.push("新闻");
  if (/八卦|娱乐|趣闻|综艺/.test(text)) needs.push("娱乐八卦");
  if (/热评|评论|网易云|留言/.test(text)) needs.push("热评");
  if (/创作背景|背景|故事|背后|来历/.test(text)) needs.push("创作背景");
  if (/歌手|动态|近况|以前|现在/.test(text)) needs.push("歌手动态");
  if (/陪伴/.test(text)) needs.push("轻松陪伴");
  return needs;
}

function contentTasteLabel(value = "") {
  const clean = cleanText(value);
  const map = {
    stories: "创作背景",
    "hot-comments": "热评",
    news: "新闻",
    gossip: "娱乐八卦"
  };
  return map[clean] || clean;
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

function primaryArtist(value = "") {
  return cleanText(value).split(/[\/,&，、]/)[0].trim();
}

function uniqueClean(items = []) {
  return [...new Set((items || []).map(cleanText).filter(Boolean))];
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (Array.isArray(item)) return item.length > 0;
      if (item && typeof item === "object") return Object.keys(item).length > 0;
      return Boolean(item);
    })
  );
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}
