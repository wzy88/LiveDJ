import { getCleanPlayableRecord, getPlayableRecord, storePlayableRecord } from "./playable-index.js";

const musicApiBase = process.env.MUSIC_API_BASE || "http://127.0.0.1:3300";

export async function resolvePlayableTrack({ songId = "", title, artist, providerIds = [], durationSec = null }) {
  const cached = songId ? getCleanPlayableRecord(songId) : null;
  const rawCached = songId ? getPlayableRecord(songId) : null;
  if (cached?.streamUrl && !isDirtyResolvedRecord(cached) && isExpectedSongMatch(cached.title, title, cached.artist, artist)) {
    return {
      id: cached.id || songId,
      title: cached.title || title,
      artist: cached.artist || artist,
      album: cached.album || "",
      coverUrl: cached.coverUrl || "",
      durationSec: cached.durationSec || durationSec,
      streamUrl: cached.streamUrl
    };
  }

  const directIds = providerIds
    .concat(rawCached?.id ? [rawCached.id] : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  for (const id of directIds) {
    const resolved = await resolveById(id, title, artist, durationSec).catch(() => null);
    if (resolved) {
      if (songId) {
        storePlayableRecord(songId, resolved);
      }
      return resolved;
    }
  }

  const keyword = `${title} ${artist}`.trim();
  const songs = await searchSongs(keyword).catch(() => []);
  const ranked = songs
    .map((song, index) => ({ song, score: scoreSong(song, title, artist, index) }))
    .filter((entry) => entry.score > 20)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  for (const entry of ranked) {
    const resolved = await resolveById(entry.song.id, entry.song.name, (entry.song.ar || entry.song.artists || []).map((item) => item.name).filter(Boolean).join(" / "), getDurationMs(entry.song) ? Math.round(getDurationMs(entry.song) / 1000) : null);
    if (!resolved) continue;
    if (songId) {
      storePlayableRecord(songId, resolved);
    }
    return resolved;
  }
  return null;
}

async function resolveById(id, title, artist, durationSec) {
  const streamUrl = await resolveSongUrl(id, durationSec ? durationSec * 1000 : null).catch(() => null);
  if (!streamUrl) return null;
  const detail = await fetchSongDetail(id).catch(() => null);
  const song = detail || {};
  const artists = song.ar || song.artists || [];
  const album = song.al || song.album || {};
  const resolved = {
    id: String(id),
    title: song.name || title,
    artist: artists.length ? artists.map((item) => item.name).filter(Boolean).join(" / ") : artist,
    album: album.name || "",
    coverUrl: album.picUrl || "",
    durationSec: getDurationMs(song) ? Math.round(getDurationMs(song) / 1000) : durationSec,
    streamUrl
  };
  if (!isExpectedSongMatch(resolved.title, title, resolved.artist, artist)) {
    return null;
  }
  if (isDirtyResolvedRecord(resolved)) {
    return null;
  }
  return resolved;
}

async function searchSongs(keyword) {
  const url = new URL("/search", musicApiBase);
  url.searchParams.set("keywords", keyword);
  url.searchParams.set("limit", "20");
  const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new Error(`search ${response.status}`);
  const data = await response.json();
  return data.result?.songs || [];
}

async function resolveSongUrl(id, expectedDurationMs) {
  const attempts = [
    ["/song/url/v1", { id: String(id), level: "standard" }],
    ["/song/url", { id: String(id) }]
  ];
  for (const [pathname, params] of attempts) {
    const url = new URL(pathname, musicApiBase);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url, { signal: AbortSignal.timeout(4500) }).catch(() => null);
    if (!response?.ok) continue;
    const data = await response.json();
    const item = data.data?.[0];
    if (item?.url && isFullUrl(item, expectedDurationMs)) return item.url;
  }
  return null;
}

async function fetchSongDetail(id) {
  const url = new URL("/song/detail", musicApiBase);
  url.searchParams.set("ids", String(id));
  const response = await fetch(url, { signal: AbortSignal.timeout(4500) }).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json();
  return data.songs?.[0] || null;
}

function scoreSong(song, expectedTitle, expectedArtist, index) {
  const artistText = (song.ar || song.artists || []).map((item) => item.name).filter(Boolean).join(" / ");
  const haystack = `${song.name} ${artistText} ${song.al?.name || song.album?.name || ""}`.toLowerCase();
  let score = 100 - index * 7;
  const actualParts = artistText.toLowerCase().split(/[\/,&，、]/).map((item) => item.replace(/\s+/g, "").trim()).filter(Boolean);
  const expectedPart = normalize(expectedArtist).split(/[\/,&，、]/)[0];
  if (!isExpectedSongMatch(song.name, expectedTitle, artistText, expectedArtist)) return -100;
  if (expectedPart && !actualParts.includes(expectedPart)) return -100;
  if (normalize(song.name).includes(normalize(expectedTitle))) score += 35;
  if (normalize(expectedTitle).includes(normalize(song.name))) score += 18;
  if (actualParts.includes(expectedPart)) score += 40;
  if (/live|现场|remix|cover|翻唱|翻自|伴奏|纯音乐|钢琴|吉他|demo|片段|试听|karaoke|instrumental|montagem|音乐社|音乐号|网友|粉丝/.test(haystack)) score -= 120;
  const duration = getDurationMs(song);
  if (duration && duration < 120000) score -= 80;
  if (duration && duration > 180000) score += 10;
  return score;
}

function isFullUrl(item, expectedDurationMs) {
  if (!item.url || item.freeTrialInfo) return false;
  if (item.time && item.time < 120000) return false;
  if (expectedDurationMs && item.time && item.time < Math.min(expectedDurationMs * 0.85, 180000)) return false;
  return true;
}

function getDurationMs(song) {
  return song.dt || song.duration || 0;
}

function normalize(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, "").trim();
}

function isDirtyResolvedRecord(record) {
  const haystack = `${record.title || ""} ${record.artist || ""} ${record.album || ""}`.toLowerCase();
  return /live|现场|演唱会|翻唱|翻自|cover|伴奏|纯音乐|钢琴|吉他|demo|片段|试听|karaoke|instrumental|remix|dj版|montagem|电台版|剪辑/.test(haystack);
}

function isExpectedSongMatch(actualTitle, expectedTitle, actualArtist, expectedArtist) {
  const actualTitleKey = normalizeSongTitle(actualTitle);
  const expectedTitleKey = normalizeSongTitle(expectedTitle);
  const actualArtistKey = normalize(actualArtist);
  const expectedArtistKey = normalize(expectedArtist).split(/[\/,&，、]/)[0];
  if (!actualTitleKey || !expectedTitleKey) return false;
  const titleMatch = actualTitleKey === expectedTitleKey || actualTitleKey.includes(expectedTitleKey) || expectedTitleKey.includes(actualTitleKey);
  const artistMatch = !expectedArtistKey || actualArtistKey.includes(expectedArtistKey) || expectedArtistKey.includes(actualArtistKey);
  return titleMatch && artistMatch;
}

function normalizeSongTitle(value = "") {
  return normalize(value)
    .replace(/（[^）]*）|\([^)]*\)|【[^】]*】|\[[^\]]*\]/g, "")
    .replace(/live版?|remix版?|cover版?|正式版|原版|录音室版|完整版|新版|旧版/g, "")
    .replace(/[-_·•"'“”‘’.,!?，。！？:：;；\s]/g, "")
    .trim();
}
