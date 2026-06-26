import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const musicApiBase = process.env.MUSIC_API_BASE || "";
let embeddedMusicApi = null;
const contextCache = new Map();

export async function fetchSongContext(track = {}, { timeoutMs = 2200 } = {}) {
  const providerId = firstProviderId(track);
  if (!providerId) return emptyContext();
  const cacheKey = String(providerId);
  if (contextCache.has(cacheKey)) return contextCache.get(cacheKey);
  const context = await withTimeout(loadSongContext(providerId, track), timeoutMs).catch(() => emptyContext());
  contextCache.set(cacheKey, context);
  if (contextCache.size > 120) {
    contextCache.delete(contextCache.keys().next().value);
  }
  return context;
}

export function summarizeSongContext({ comments = [], track = {} } = {}) {
  const cleanComments = (comments || [])
    .map(normalizeComment)
    .filter(Boolean)
    .filter((text) => text.length >= 8 && text.length <= 160)
    .filter((text) => !isLowQualityComment(text))
    .slice(0, 10);
  const commentExcerpts = cleanComments
    .filter((text) => isGoodCommentExcerpt(text))
    .sort((left, right) => scoreCommentExcerpt(right) - scoreCommentExcerpt(left))
    .map((text) => ({
      text,
      theme: commentToThemeLabel(text),
      source: "netease-hot-comment"
    }))
    .filter((item) => item.text && item.text.length <= 70)
    .slice(0, 4);
  const hotCommentThemes = uniqueItems(cleanComments
    .map(commentToTheme)
    .filter(Boolean))
    .slice(0, 3);
  const storySummary = buildStorySummary(hotCommentThemes, track);
  return {
    provider: cleanComments.length ? "netease-comments" : "",
    commentCount: cleanComments.length,
    commentExcerpts,
    hotCommentThemes,
    storySummary
  };
}

function firstProviderId(track = {}) {
  const direct = Number(track.resolvedTrack?.id || track.providerId || track.neteaseId || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const fromList = (track.providerIds || [])
    .map((id) => Number(id))
    .find((id) => Number.isFinite(id) && id > 0);
  return fromList || 0;
}

async function loadSongContext(providerId, track) {
  const comments = await fetchHotComments(providerId);
  return summarizeSongContext({ comments, track });
}

async function fetchHotComments(providerId) {
  const embedded = await callEmbeddedMusicApi("comment_music", { id: String(providerId), limit: "50" });
  const embeddedComments = extractComments(embedded);
  if (embeddedComments.length) return embeddedComments;
  if (!musicApiBase) return [];
  const url = new URL("/comment/music", musicApiBase);
  url.searchParams.set("id", String(providerId));
  url.searchParams.set("limit", "50");
  const response = await fetch(url, { signal: AbortSignal.timeout(2200) }).catch(() => null);
  if (!response?.ok) return [];
  const data = await response.json().catch(() => null);
  return extractComments(data);
}

function extractComments(data) {
  return [
    ...(data?.hotComments || []),
    ...(data?.comments || [])
  ].map((comment) => comment?.content || "").filter(Boolean);
}

function normalizeComment(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .replace(/@[\w\u4e00-\u9fff_-]+/g, "")
    .trim();
}

function commentToTheme(comment = "") {
  const clean = normalizeComment(comment)
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ");
  if (!clean) return "";
  if (/(城市|离开|告别|再见|车站|机场|远方|旅行|路上)/.test(clean)) {
    return `有人把它听成一段关于离开、路上和告别的故事`;
  }
  if (/(前任|分手|想你|遗憾|错过|后来|没说出口|没寄出)/.test(clean)) {
    return `有人在评论里把它留给没说出口的遗憾`;
  }
  if (/(下班|深夜|失眠|一个人|晚安|凌晨|睡不着)/.test(clean)) {
    return `有人在深夜或一个人的时候，把这首歌当成陪伴`;
  }
  if (/(青春|高中|大学|毕业|朋友|同桌|少年)/.test(clean)) {
    if (/(毕业|不同城市|大学)/.test(clean)) return `有人把它和毕业、朋友去了不同城市联系在一起`;
    if (/(同桌|教室|高中)/.test(clean)) return `有人听到它会想起高中教室和同桌分享的歌`;
    return `有人把它听成少年时期朋友留下来的回忆`;
  }
  if (/(见一面|幻想|以后|未来|结婚|初恋|喜欢|爱过|在一起|重逢|再遇见|陪你)/.test(clean)) {
    return `有人把它听成关于靠近、期待和关系的故事`;
  }
  return "";
}

function commentToThemeLabel(comment = "") {
  const clean = normalizeComment(comment);
  if (/(城市|离开|告别|再见|车站|机场|远方|旅行|路上|箱子)/.test(clean)) return "离开/路上/告别";
  if (/(前任|分手|想你|遗憾|错过|后来|没说出口|没寄出)/.test(clean)) return "遗憾/没说出口";
  if (/(下班|深夜|失眠|一个人|晚安|凌晨|睡不着)/.test(clean)) return "深夜/陪伴";
  if (/(青春|高中|大学|毕业|朋友|同桌|少年)/.test(clean)) return "青春/朋友";
  if (/(见一面|幻想|以后|未来|结婚|初恋|喜欢|爱过|在一起|重逢|再遇见|陪你)/.test(clean)) return "靠近/期待";
  return "听众故事";
}

function isLowQualityComment(text = "") {
  return /求赞|互粉|打卡|沙发|第一|999|网易云|热评|点赞|感谢大家|谢谢大家|支持这首|美女太多|哈哈|多多大笑|病魔|护法|抖音|特效|皱纹|诸君|诸位|道友|为何喜欢这曲|\[[^\]]+\]/.test(text);
}

function isGoodCommentExcerpt(text = "") {
  const clean = normalizeComment(text);
  if (clean.length < 8 || clean.length > 70) return false;
  if (/歌词|副歌|开头那句|最后那句|这段话|很喜欢这段|摘抄|文案|封神|作词|唱到|写到|顾城|海子|村上|网易云音乐|病魔|护法|抖音|特效|皱纹|诸君|诸位|道友|为何喜欢这曲|——|《[^》]{1,16}》/.test(clean)) return false;
  if (/[“”"']/.test(clean) && !/(我|去年|今天|昨晚|凌晨|北京|车站|公司|学校|妈妈|朋友|女朋友|男朋友)/.test(clean)) return false;
  if (/^[“”"']|[“”"']$/.test(clean)) return false;
  if (looksLikeLyricFragment(clean)) return false;
  return true;
}

function scoreCommentExcerpt(text = "") {
  const clean = normalizeComment(text);
  let score = 0;
  if (/(我|妈妈|父母|朋友|室友|同桌|女朋友|男朋友|初恋|一个人)/.test(clean)) score += 4;
  if (/(北京|上海|广州|成都|西站|北站|车站|机场|地铁|三环|公司|学校|操场|教室|Livehouse)/i.test(clean)) score += 4;
  if (/(去年|今天|昨晚|凌晨|晚上|冬天|夏天|毕业|结婚|下班|等车|拖着箱子|发消息|出来)/.test(clean)) score += 4;
  if (/(突然|后来|那天|正好|刚好|再也|不想)/.test(clean)) score += 2;
  if (/(喜欢你|爱你|想你|晚安)$/.test(clean)) score -= 3;
  return score;
}

function looksLikeLyricFragment(text = "") {
  const clean = normalizeComment(text);
  const hasStoryMarker = /(我|去年|今天|昨晚|凌晨|北京|车站|公司|学校|妈妈|朋友|女朋友|男朋友|结婚|下班|等车|拖着|耳机)/.test(clean);
  if (hasStoryMarker) return false;
  if (/[\u4e00-\u9fff]{2,}\s+[\u4e00-\u9fff]{2,}\s+[\u4e00-\u9fff]{2,}/.test(clean)) return true;
  if (clean.length <= 32 && /(爱你|想你|喜欢你|得你|失你|晚安|成瘾|入魔)/.test(clean)) return true;
  return false;
}

function buildStorySummary(themes, track = {}) {
  if (!themes?.length) return "";
  const title = track?.title ? `《${track.title}》` : "这首歌";
  return `${title}下面的评论更像一组私人故事：${themes.slice(0, 2).join("；")}。`;
}

function uniqueItems(items = []) {
  return [...new Set(items)];
}

function emptyContext() {
  return {
    provider: "",
    commentCount: 0,
    commentExcerpts: [],
    hotCommentThemes: [],
    storySummary: ""
  };
}

async function callEmbeddedMusicApi(method, params) {
  const api = getEmbeddedMusicApi();
  if (!api?.[method]) return null;
  try {
    const result = await api[method](params);
    return result?.body || null;
  } catch {
    return null;
  }
}

function getEmbeddedMusicApi() {
  if (embeddedMusicApi !== null) return embeddedMusicApi;
  try {
    embeddedMusicApi = require("NeteaseCloudMusicApi");
  } catch {
    embeddedMusicApi = false;
  }
  return embeddedMusicApi || null;
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(emptyContext()), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}
