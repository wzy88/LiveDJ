import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let embeddedMusicApi = null;
const artistCache = new Map();

export async function fetchArtistContext(track = {}, { timeoutMs = 2200 } = {}) {
  const artistName = firstArtistName(track.artist);
  if (!artistName) return emptyArtistContext();
  const cacheKey = artistName;
  if (artistCache.has(cacheKey)) return artistCache.get(cacheKey);
  const context = await withTimeout(loadArtistContext(artistName, track), timeoutMs).catch(() => emptyArtistContext());
  artistCache.set(cacheKey, context);
  if (artistCache.size > 120) artistCache.delete(artistCache.keys().next().value);
  return context;
}

export function summarizeArtistContext({ track = {}, detail = null, description = null } = {}) {
  const name = cleanText(
    detail?.data?.artist?.name ||
    detail?.artist?.name ||
    firstArtistName(track.artist)
  );
  const rawBrief = cleanText(
    detail?.data?.artist?.briefDesc ||
    detail?.artist?.briefDesc ||
    description?.briefDesc ||
    ""
  ).slice(0, 120);
  const brief = isSpamArtistFact(rawBrief) ? "" : rawBrief;
  const facts = extractIntroductionFacts(description)
    .filter((item) => !isSpamArtistFact(item))
    .filter((item) => item && item !== brief)
    .slice(0, 3);
  if (!name && !brief && !facts.length) return emptyArtistContext();
  return {
    provider: "netease-artist",
    name,
    brief,
    facts
  };
}

async function loadArtistContext(artistName, track) {
  const artistId = await findArtistId(artistName);
  if (!artistId) return emptyArtistContext();
  const [detail, description] = await Promise.all([
    callEmbeddedMusicApi("artist_detail", { id: String(artistId) }),
    callEmbeddedMusicApi("artist_desc", { id: String(artistId) })
  ]);
  return summarizeArtistContext({ track, detail, description });
}

async function findArtistId(artistName) {
  const data = await callEmbeddedMusicApi("cloudsearch", {
    keywords: artistName,
    type: "100",
    limit: "5"
  });
  const artists = data?.result?.artists || [];
  const exact = artists.find((artist) => cleanText(artist.name) === artistName);
  const candidate = exact || artists[0];
  const id = Number(candidate?.id || 0);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function extractIntroductionFacts(description = {}) {
  const introductions = Array.isArray(description?.introduction) ? description.introduction : [];
  return introductions
    .map((item) => cleanText(item?.txt || item?.text || ""))
    .filter(Boolean)
    .map((text) => text.slice(0, 110))
    .slice(0, 4);
}

function isSpamArtistFact(value = "") {
  return /(?:群加|加群|vx|微信|微.?信|qq|QQ|非本人|本人不在|私信|联系|[a-z0-9._-]{4,}\d{2,})/i.test(value);
}

function firstArtistName(value = "") {
  return cleanText(String(value || "").split(/[\/,&，、]/)[0] || "");
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

function emptyArtistContext() {
  return {
    provider: "",
    name: "",
    brief: "",
    facts: []
  };
}

function cleanText(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim();
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(emptyArtistContext()), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}
