const researchCache = new Map();

export async function fetchTrackResearch(track = {}, { query = "", brief = {}, timeoutMs = 2200, searchProvider = fetchConfiguredSearch } = {}) {
  const cacheKey = [track.id || track.title, track.artist, query].map(cleanText).join("|");
  if (researchCache.has(cacheKey)) return researchCache.get(cacheKey);
  const items = await withTimeout(searchProvider(track, { query, brief, timeoutMs }), timeoutMs).catch(() => []);
  const research = summarizeTrackResearch({ track, items });
  researchCache.set(cacheKey, research);
  if (researchCache.size > 120) researchCache.delete(researchCache.keys().next().value);
  return research;
}

export function summarizeTrackResearch({ track = {}, items = [] } = {}) {
  const cleanItems = normalizeSearchItems(items)
    .filter((item) => !isLowQualitySearchText(`${item.title} ${item.snippet}`))
    .slice(0, 8);
  const text = cleanItems.map((item) => `${item.title} ${item.snippet}`).join(" ");
  const audibleCues = uniqueClean([
    ...inferAudibleCuesFromTrack(track),
    ...inferAudibleCuesFromText(text)
  ]).slice(0, 5);
  const listenerAngles = uniqueClean(inferListenerAngles(text)).slice(0, 4);
  const backgroundFacts = uniqueClean(inferBackgroundFacts(text)).slice(0, 4);
  const talkSeeds = uniqueClean([
    ...buildTalkSeeds({ audibleCues, listenerAngles, track }),
    ...cleanItems.map((item) => sentenceSeed(item.snippet)).filter(Boolean)
  ]).slice(0, 5);

  if (!audibleCues.length && !listenerAngles.length && !backgroundFacts.length && !talkSeeds.length) return emptyResearch();
  return {
    provider: "search-summary",
    audibleCues,
    backgroundFacts,
    listenerAngles,
    talkSeeds,
    sources: cleanItems.map((item) => ({
      title: item.title,
      url: item.url
    })).filter((item) => item.title || item.url).slice(0, 4),
    confidence: cleanItems.length ? "search-summary" : "track-tags"
  };
}

async function fetchConfiguredSearch(track = {}, { query = "", brief = {}, timeoutMs = 2200 } = {}) {
  const endpoint = cleanText(process.env.TRACK_RESEARCH_API_URL || "");
  if (!endpoint) return fetchBingSearch(track, { query, brief, timeoutMs });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: buildResearchQuery(track, query, brief),
      track: {
        title: track.title || "",
        artist: track.artist || "",
        genres: values(track.genres),
        moods: values(track.moods),
        scenes: values(track.scenes)
      }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  }).catch(() => null);
  if (!response?.ok) return [];
  const data = await response.json().catch(() => null);
  return Array.isArray(data?.items) ? data.items : Array.isArray(data?.results) ? data.results : [];
}

async function fetchBingSearch(track = {}, { query = "", brief = {}, timeoutMs = 2200 } = {}) {
  const queries = buildResearchQueries(track, query, brief);
  if (!queries.length) return [];
  const perQueryTimeout = Math.max(650, Math.min(timeoutMs, 1600));
  const settled = await Promise.allSettled(queries.map((searchQuery) => fetchSingleBingSearch(searchQuery, track, perQueryTimeout)));
  return uniqueSearchItems(settled.flatMap((result) => result.status === "fulfilled" ? result.value : [])).slice(0, 6);
}

async function fetchSingleBingSearch(query, track = {}, timeoutMs = 1200) {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("setlang", "zh-CN");
  url.searchParams.set("cc", "CN");
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 ClaudioRadio/0.1 (+https://example.com)",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5"
    },
    signal: AbortSignal.timeout(timeoutMs)
  }).catch(() => null);
  if (!response?.ok) return [];
  const html = await response.text().catch(() => "");
  return parseBingSearchResults(html, track);
}

export function parseBingSearchResults(html = "", track = {}) {
  const blocks = String(html || "").split(/<li class="b_algo"[^>]*>/i).slice(1);
  return blocks
    .map((block) => {
      const h2 = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i);
      const paragraph = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      return {
        title: decodeHtml(stripTags(h2?.[2] || "")),
        snippet: decodeHtml(stripTags(paragraph?.[1] || "")),
        url: decodeHtml(h2?.[1] || "")
      };
    })
    .filter((item) => item.title || item.snippet)
    .filter((item) => isRelevantResult(item, track))
    .filter((item) => !isLowQualitySearchText(`${item.title} ${item.snippet} ${item.url}`))
    .slice(0, 6);
}

function buildResearchQuery(track = {}, query = "", brief = {}) {
  return buildResearchQueries(track, query, brief)[0] || "";
}

function buildResearchQueries(track = {}, query = "", brief = {}) {
  const title = cleanText(track.title || "");
  const artist = firstArtist(track.artist || "");
  if (!title && !artist) return [];
  const scene = cleanText(brief.scene || query || "");
  const quotedTitle = quoteQuery(title);
  const quotedArtist = quoteQuery(artist);
  const sceneTail = scene ? ` ${scene}` : "";
  return [
    `site:music.163.com/song ${quotedTitle} ${quotedArtist}`,
    `site:y.qq.com ${quotedTitle} ${quotedArtist}`,
    `${quotedTitle} ${quotedArtist} 歌曲 听感 评论 网易云音乐 QQ音乐 豆瓣${sceneTail}`,
    `${quotedTitle} ${quotedArtist} 专辑 创作 背景 评论${sceneTail}`
  ].map(cleanText).filter(Boolean);
}

function isRelevantResult(item = {}, track = {}) {
  const text = normalizeForMatch(`${item.title} ${item.snippet}`);
  const url = normalizeForMatch(item.url || "");
  const title = normalizeForMatch(track.title || "");
  const artistTokens = artistMatchTokens(track.artist || "");
  if (!title || !text.includes(title)) return false;
  const hasArtist = artistTokens.some((artist) => text.includes(artist));
  const trustedMusicSource = isTrustedMusicSource(url);
  const musicContext = trustedMusicSource || /(歌曲|歌手|专辑|单曲|音乐|作词|作曲|编曲|发行|评论|听感|网易云|qq音乐|豆瓣音乐)/i.test(`${item.title} ${item.snippet}`);
  if (hasArtist && musicContext) return true;
  return trustedMusicSource && hasArtist;
}

function stripTags(value = "") {
  return String(value).replace(/<[^>]+>/g, " ");
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&ensp;|&#8194;/g, " ")
    .replace(/&emsp;|&#8195;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const number = Number(code);
      return Number.isFinite(number) ? String.fromCharCode(number) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchItems(items = []) {
  return (items || [])
    .map((item) => ({
      title: cleanText(typeof item === "string" ? "" : item?.title || item?.name || ""),
      snippet: cleanText(typeof item === "string" ? item : item?.snippet || item?.summary || item?.text || item?.content || ""),
      url: cleanText(typeof item === "string" ? "" : item?.url || item?.link || "")
    }))
    .filter((item) => item.title || item.snippet);
}

function inferAudibleCuesFromTrack(track = {}) {
  const haystack = values([...(track.genres || []), ...(track.moods || [])]).join(" ");
  return inferAudibleCuesFromText(haystack);
}

function inferAudibleCuesFromText(value = "") {
  const text = cleanText(value);
  const cues = [];
  if (/R&B|rnb|低频|贝斯|bass/i.test(text)) cues.push("R&B低频");
  if (/人声|嗓音|声线|贴近|耳边|清澈/.test(text)) cues.push(/清澈/.test(text) ? "清澈人声" : "人声贴近");
  if (/鼓点|节拍|律动|节奏/.test(text)) cues.push(/不急|缓慢|慢/.test(text) ? "节奏不急" : "节奏清楚");
  if (/吉他|木吉他|民谣/.test(text)) cues.push("吉他铺底");
  if (/电子|合成器|氛围/.test(text)) cues.push("电子氛围");
  if (/明亮|亮色|轻快/.test(text)) cues.push("明亮音色");
  if (/松弛|放松|不抢/.test(text)) cues.push("不抢注意力");
  return cues;
}

function inferListenerAngles(value = "") {
  const text = cleanText(value);
  const angles = [];
  if (/加班|工作|桌前|办公室|文档|屏幕/.test(text)) angles.push("桌前工作时不抢注意力");
  if (/夜|凌晨|独处|一个人/.test(text)) angles.push("夜里独处时放轻情绪");
  if (/路上|通勤|地铁|车站|旅行/.test(text)) angles.push("适合路上和过渡场景");
  if (/放轻|松弛|缓和|陪伴/.test(text)) angles.push("让情绪慢慢放轻");
  return angles;
}

function inferBackgroundFacts(value = "") {
  return splitSentences(value)
    .filter((line) => /(发行|专辑|收录|创作|合作|翻红|讨论|常被|很多人|评论)/.test(line))
    .map((line) => line.slice(0, 70))
    .slice(0, 4);
}

function buildTalkSeeds({ audibleCues = [], listenerAngles = [], track = {} } = {}) {
  const seeds = [];
  if (audibleCues.includes("R&B低频") || audibleCues.includes("人声贴近")) {
    seeds.push("低频和人声可以放近一点，适合在旁边铺开");
  }
  if (audibleCues.includes("节奏不急") || audibleCues.includes("不抢注意力")) {
    seeds.push("节奏不要抢手边的注意力，只负责把状态托住");
  }
  if (listenerAngles.some((item) => /桌前|工作/.test(item))) {
    seeds.push("桌前听的时候，不必被歌拽走，手上的事还能继续");
  }
  if (!seeds.length && track.title) seeds.push("先抓住这首歌的声音质感，不急着讲故事");
  return seeds;
}

function sentenceSeed(value = "") {
  const sentence = splitSentences(value).find((item) => /(人声|低频|节奏|桌前|工作|夜|独处|放轻|不抢|情绪|评论)/.test(item));
  return sentence ? sentence.slice(0, 70) : "";
}

function splitSentences(value = "") {
  return cleanText(value)
    .split(/[。！？.!?；;]/)
    .map(cleanText)
    .filter((item) => item.length >= 6 && item.length <= 120);
}

function isLowQualitySearchText(value = "") {
  return /下载|铃声|网盘|无损|MP3|在线试听|免费|百度云|pan\.baidu|歌词|作词[:：]|作曲[:：]|lyrics?|azlyric|lyricdb|LRC/i.test(value);
}

function values(items = []) {
  return (items || []).map((item) => cleanText(item?.value || item)).filter(Boolean);
}

function firstArtist(value = "") {
  return cleanText(String(value || "").split(/[\/,&，、]/)[0] || "");
}

function artistMatchTokens(value = "") {
  return String(value || "")
    .split(/[\/,&，、]/)
    .map(normalizeForMatch)
    .filter((item) => item.length >= 2);
}

function isTrustedMusicSource(url = "") {
  return /music\.163\.com\/(?:#\/)?song|y\.qq\.com|c6\.y\.qq\.com|music\.douban\.com/i.test(url);
}

function normalizeForMatch(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, "")
    .replace(/[《》"'“”‘’（）()【】\[\]\-_\s]/g, "")
    .trim();
}

function quoteQuery(value = "") {
  const cleaned = cleanText(value).replace(/"/g, "");
  return cleaned ? `"${cleaned}"` : "";
}

function uniqueSearchItems(items = []) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = cleanText(item.url || `${item.title}|${item.snippet}`);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function uniqueClean(items = []) {
  return [...new Set(items.map(cleanText).filter(Boolean))];
}

function emptyResearch() {
  return {
    provider: "",
    audibleCues: [],
    backgroundFacts: [],
    listenerAngles: [],
    talkSeeds: [],
    sources: [],
    confidence: "empty"
  };
}

function cleanText(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 180);
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve([]), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}
