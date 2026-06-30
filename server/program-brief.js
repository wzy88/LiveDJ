export function buildProgramBrief(query = "") {
  const text = cleanText(query);
  const city = inferCity(text);
  const contentTaste = inferContentTaste(text);
  const timeIntent = inferTimeIntent(text);
  const scene = inferScene(text);
  const languages = inferLanguages(text);
  const moods = inferMoods(text);
  const queueMode = inferQueueMode(text);
  const wantsEditorial = contentTaste.some((item) => ["stories", "hot-comments", "news", "gossip"].includes(item)) || city;

  return {
    rawQuery: text,
    format: wantsEditorial ? "city-editorial" : "personal-companion",
    city: city || "北京",
    timeIntent,
    scene,
    mood: moods,
    contentTaste,
    musicTaste: {
      languages,
      genres: inferGenres(text)
    },
    talkDensity: wantsEditorial ? "rich" : "medium",
    queueMode
  };
}

function inferCity(text) {
  if (/北京/.test(text)) return "北京";
  if (/上海/.test(text)) return "上海";
  if (/广州/.test(text)) return "广州";
  if (/深圳/.test(text)) return "深圳";
  return "";
}

function inferContentTaste(text) {
  const tastes = [];
  if (/(故事|背后|经历|来历|往事)/.test(text)) tastes.push("stories");
  if (/(热评|评论|网易云|留言)/.test(text)) tastes.push("hot-comments");
  if (/(新闻|资讯|消息|热点|今天.*聊)/.test(text)) tastes.push("news");
  if (/(八卦|艺人|歌手|绯闻|趣闻|幕后)/.test(text)) tastes.push("gossip");
  if (!tastes.length && /(电台|节目|主持|口播)/.test(text)) tastes.push("stories", "news");
  return [...new Set(tastes)];
}

function inferTimeIntent(text) {
  if (/(深夜|凌晨|睡前|失眠)/.test(text)) return "late-night";
  if (/(早上|清晨|早高峰|上班)/.test(text)) return "morning";
  if (/(上午)/.test(text)) return "morning";
  if (/(中午|午休|午间)/.test(text)) return "noon";
  if (/(下午|午后)/.test(text)) return "afternoon";
  if (/(晚上|夜里|今晚|下班|回家|晚高峰)/.test(text)) return "evening";
  return "current";
}

function inferScene(text) {
  if (/(上午.*工作|工作间隙|会议间隙)/.test(text)) return "工作学习";
  if (/(回家|下班|晚高峰)/.test(text)) return "回家路上";
  if (/(通勤|地铁|开车|公交|路上)/.test(text)) return "通勤路上";
  if (/(散步|走路|遛弯)/.test(text)) return "散步";
  if (/(睡前|失眠|深夜)/.test(text)) return "睡前";
  if (/(工作|学习|写东西)/.test(text)) return "工作学习";
  return "";
}

function inferLanguages(text) {
  if (/(粤语)/.test(text)) return ["粤语"];
  if (/(华语|中文|国语|中文歌|国内)/.test(text)) return ["华语"];
  return [];
}

function inferMoods(text) {
  const moods = [];
  if (/(松弛|放松|轻松)/.test(text)) moods.push("松弛");
  if (/(有故事|故事感|叙事)/.test(text)) moods.push("有故事");
  if (/(别太丧|不要太丧|不太丧)/.test(text)) moods.push("不太丧");
  if (/(emo|难过|低落|想哭)/.test(text)) moods.push("情绪");
  if (/(开心|热闹|提神|有劲)/.test(text)) moods.push("明亮");
  return [...new Set(moods)];
}

function inferGenres(text) {
  const genres = [];
  if (/(民谣)/.test(text)) genres.push("民谣");
  if (/(R&B|rnb|灵魂)/i.test(text)) genres.push("R&B");
  if (/(摇滚)/.test(text)) genres.push("摇滚");
  if (/(说唱|rap|嘻哈)/i.test(text)) genres.push("说唱");
  if (/(流行|pop)/i.test(text)) genres.push("流行");
  return genres;
}

function inferQueueMode(text) {
  if (/(后面|接下来|下一首|当前.*别打断|不要打断|别打断|播完.*再|后续)/.test(text)) {
    return "append-after-current";
  }
  return "replace";
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}
