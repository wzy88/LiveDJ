import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const defaultOldIndex = "/Users/wzy/Desktop/CodeX-20260303/近期项目合集/2026-04-27-Ai电台/个人电台/data/public-playlist-corpus/netease-public-playlists.json";
const sourcePath = process.env.PUBLIC_PLAYLIST_INDEX_PATH || defaultOldIndex;
const outPath = path.join(rootDir, "data", "song-graph.json");

const raw = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const playlists = raw.items || raw.playlists || [];

const songs = new Map();
const edgeWeights = new Map();
const artistCounts = new Map();

for (const playlist of playlists) {
  const tracks = normalizePlaylistTracks(playlist).slice(0, 36);
  const playlistSignals = collectPlaylistSignals(playlist);
  const quality = Number.isFinite(playlist.qualityScore) ? playlist.qualityScore : 50;
  const playWeight = Math.min(8, Math.log10(Math.max(1, playlist.playCount || 1)));
  const playlistWeight = Math.max(0.4, quality / 50 + playWeight / 8);

  for (const [index, track] of tracks.entries()) {
    const key = songKey(track.title, track.artist);
    if (!key || isBadTrackName(track.title, track.artist)) continue;
    const existing = songs.get(key) || createSong(track);
    existing.appearances += 1;
    existing.score += playlistWeight * (1 - Math.min(index, 24) * 0.012);
    existing.qualityScore += quality;
    if (track.providerId) {
      existing.providerIds[track.providerId] = (existing.providerIds[track.providerId] || 0) + 1;
    }
    if (track.durationSec && (!existing.durationSec || track.durationSec > existing.durationSec)) {
      existing.durationSec = track.durationSec;
    }
    existing.sources.push({
      playlistId: playlist.playlistId,
      title: playlist.title,
      qualityScore: quality,
      playCount: playlist.playCount || 0
    });
    addWeightedValues(existing.scenes, playlistSignals.scenes, playlistWeight);
    addWeightedValues(existing.moods, playlistSignals.moods, playlistWeight);
    addWeightedValues(existing.genres, playlistSignals.genres, playlistWeight);
    addWeightedValues(existing.languages, playlistSignals.languages, playlistWeight);
    addWeightedValues(existing.eras, playlistSignals.eras, playlistWeight);
    addWeightedValues(existing.personas, playlistSignals.personas, playlistWeight);
    songs.set(key, existing);
    artistCounts.set(track.artist, (artistCounts.get(track.artist) || 0) + 1);
  }

  const uniqueKeys = Array.from(new Set(tracks.map((track) => songKey(track.title, track.artist)).filter(Boolean)));
  for (let i = 0; i < uniqueKeys.length; i += 1) {
    for (let j = i + 1; j < Math.min(uniqueKeys.length, i + 18); j += 1) {
      addEdge(uniqueKeys[i], uniqueKeys[j], playlistWeight / Math.max(1, j - i));
    }
  }
}

const songList = Array.from(songs.values()).map((song) => {
  const avgQuality = song.qualityScore / Math.max(1, song.appearances);
  return {
    ...song,
    qualityScore: round(avgQuality),
    score: round(song.score + Math.min(8, song.appearances * 0.8)),
    scenes: topWeighted(song.scenes, 8),
    moods: topWeighted(song.moods, 10),
    genres: topWeighted(song.genres, 8),
    languages: topWeighted(song.languages, 5),
    eras: topWeighted(song.eras, 5),
    personas: topWeighted(song.personas, 5),
    providerIds: topWeighted(song.providerIds, 6).map((item) => item.value),
    sources: song.sources
      .sort((left, right) => (right.qualityScore || 0) - (left.qualityScore || 0))
      .slice(0, 4),
    neighbors: []
  };
}).filter((song) => song.appearances >= 2 || song.score >= 4);

const byId = new Map(songList.map((song) => [song.id, song]));
for (const [edgeKey, weight] of edgeWeights.entries()) {
  const [left, right] = edgeKey.split("\t");
  const leftSong = byId.get(left);
  const rightSong = byId.get(right);
  if (!leftSong || !rightSong) continue;
  leftSong.neighbors.push(toNeighbor(rightSong, weight));
  rightSong.neighbors.push(toNeighbor(leftSong, weight));
}

for (const song of songList) {
  song.neighbors = song.neighbors
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 20)
    .map((neighbor) => ({ ...neighbor, weight: round(neighbor.weight) }));
}

const invertedIndex = {};
for (const song of songList) {
  for (const token of tokenize(`${song.title} ${song.artist} ${song.scenes.map((x) => x.value).join(" ")} ${song.moods.map((x) => x.value).join(" ")} ${song.genres.map((x) => x.value).join(" ")}`)) {
    if (!invertedIndex[token]) invertedIndex[token] = [];
    if (invertedIndex[token].length < 160) invertedIndex[token].push(song.id);
  }
}

songList.sort((left, right) => right.score - left.score);

const graph = {
  generatedAt: new Date().toISOString(),
  sourcePath,
  playlistCount: playlists.length,
  songCount: songList.length,
  artistCount: artistCounts.size,
  songs: songList,
  invertedIndex
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(graph)}\n`);
console.log(`Built ${songList.length} song profiles from ${playlists.length} playlists -> ${outPath}`);

function normalizePlaylistTracks(playlist) {
  const tracks = playlist.tracks?.length ? playlist.tracks : playlist.sampleTracks || [];
  return tracks
    .map((track) => ({
      title: cleanText(track.title || track.name),
      artist: cleanText((track.artists || track.ar || []).map((artist) => artist.name || artist).filter(Boolean).join(" / ")),
      providerId: track.id ? String(track.id) : "",
      durationSec: Number(track.durationSec || 0)
    }))
    .filter((track) => track.title && track.artist);
}

function collectPlaylistSignals(playlist) {
  const distilled = playlist.distilled || {};
  return {
    scenes: distilled.scenes || [],
    moods: distilled.moods || [],
    genres: distilled.genres || [],
    languages: distilled.languages || [],
    eras: distilled.eras || [],
    personas: distilled.recommendedPersonaIds || []
  };
}

function createSong(track) {
  return {
    id: songKey(track.title, track.artist),
    title: track.title,
    artist: track.artist,
    appearances: 0,
    score: 0,
    qualityScore: 0,
    scenes: {},
    moods: {},
    genres: {},
    languages: {},
    eras: {},
    personas: {},
    providerIds: {},
    durationSec: null,
    sources: []
  };
}

function addWeightedValues(target, values, weight) {
  for (const value of values || []) {
    const normalized = cleanText(value);
    if (!normalized) continue;
    target[normalized] = (target[normalized] || 0) + weight;
  }
}

function topWeighted(record, limit) {
  return Object.entries(record)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([value, weight]) => ({ value, weight: round(weight) }));
}

function addEdge(left, right, weight) {
  if (left === right) return;
  const [a, b] = left < right ? [left, right] : [right, left];
  const key = `${a}\t${b}`;
  edgeWeights.set(key, (edgeWeights.get(key) || 0) + weight);
}

function toNeighbor(song, weight) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    weight
  };
}

function songKey(title, artist) {
  const titleKey = normalizeSongTitle(title);
  const artistKey = normalizeArtist(artist);
  return titleKey && artistKey ? `${titleKey}::${artistKey}` : "";
}

function normalizeSongTitle(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/（[^）]*）|\([^)]*\)|【[^】]*】|\[[^\]]*\]/g, "")
    .replace(/live版?|remix版?|cover版?|正式版|原版|录音室版|完整版|新版|旧版/g, "")
    .replace(/[-_·•"'“”‘’.,!?，。！？:：;；\s]/g, "")
    .trim();
}

function normalizeArtist(value = "") {
  return cleanText(value)
    .toLowerCase()
    .split(/[\/,&，、]| feat\.? | ft\.? /i)[0]
    .replace(/\s+/g, "")
    .trim();
}

function cleanText(value = "") {
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function isBadTrackName(title, artist) {
  const haystack = `${title} ${artist}`.toLowerCase();
  return /伴奏|karaoke|儿童歌曲|宝宝巴士|直播|电台节目|有声书|播客|纯享版|评论区|网友|粉丝|音乐社|音乐号/.test(haystack);
}

function tokenize(value) {
  const normalized = cleanText(value).toLowerCase();
  const known = [
    "通勤", "夜晚", "深夜", "睡前", "失眠", "学习", "工作", "专注", "做饭", "散步",
    "温柔", "治愈", "浪漫", "伤感", "快乐", "安静", "放松", "华语", "粤语", "日语",
    "韩语", "欧美", "民谣", "摇滚", "电子", "爵士", "r&b", "city pop", "怀旧"
  ];
  const split = normalized
    .split(/[\s,，.。/|｜:：;；\-_—()[\]【】"'“”‘’]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  return Array.from(new Set([...known.filter((token) => normalized.includes(token)), ...split]));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
