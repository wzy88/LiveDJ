export function buildTalkBrief({
  query = "",
  queueIndex = 0,
  track = {},
  nextTrack = null,
  brief = {},
  contentPack = {},
  broadcastContext = {}
} = {}) {
  const userKeywords = buildUserKeywords({ query, brief, track, contentPack, broadcastContext });
  const currentTrack = buildCurrentTrackBrief(track, contentPack);
  const materials = buildMaterials({ contentPack, broadcastContext });
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
    userKeywords,
    currentTrack,
    nextTrack: nextTrack ? compactObject({
      title: cleanText(nextTrack.title || ""),
      artist: cleanText(nextTrack.artist || ""),
      role: "用于自然预告下一首，不能像报幕"
    }) : null,
    materials,
    writingTask: "写一段200-300字以内的中文电台口播，必须融合用户命题、当前歌曲、可用热评/故事、歌手信息、天气/新闻/娱乐八卦等素材；不要空泛，不要主持腔，不要编造输入里没有的事实。",
    mustMention,
    bannedPhrases
  });
}

function buildUserKeywords({ query = "", brief = {}, track = {}, contentPack = {}, broadcastContext = {} } = {}) {
  const text = cleanText(query);
  const artist = primaryArtist(track.artist || contentPack.artist?.name || "");
  return {
    artists: uniqueClean([
      ...extractKnownArtists(text, artist),
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
      ...values(track.moods).slice(0, 2)
    ]).slice(0, 5),
    content: uniqueClean([
      ...extractContentNeeds(text),
      ...(brief.contentTaste || []).map(contentTasteLabel)
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
  if (/通勤|地铁|公交|路上/.test(text)) scenes.push("通勤路上");
  if (/回家|下班|晚高峰/.test(text)) scenes.push("回家路上");
  if (/睡前|失眠/.test(text)) scenes.push("睡前");
  return scenes;
}

function extractMoods(text = "") {
  const moods = [];
  if (/犯困|困|提神|醒/.test(text)) moods.push("犯困", "提神");
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
