import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCleanPlayableRecord } from "./playable-index.js";
import { resolvePlayableTrack } from "./music.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const graphPath = path.join(rootDir, "data", "song-graph.json");
const profilePath = path.join(rootDir, "data", "user-profile.json");

let graphCache = null;

export function loadGraph() {
  if (!graphCache) {
    if (!fs.existsSync(graphPath)) {
      throw new Error("song graph is missing. Run npm run graph:build first.");
    }
    const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
    graph.byId = new Map(graph.songs.map((song) => [song.id, song]));
    graph.byTitle = new Map();
    for (const song of graph.songs) {
      const key = normalizeSongTitle(song.title);
      if (!graph.byTitle.has(key)) graph.byTitle.set(key, []);
      graph.byTitle.get(key).push(song);
    }
    graphCache = graph;
  }
  return graphCache;
}

export function loadProfile() {
  if (!fs.existsSync(profilePath)) {
    return {
      importedTracks: [],
      feedback: {},
      recent: [],
      events: [],
      updatedAt: null
    };
  }
  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  profile.importedTracks = profile.importedTracks || [];
  profile.feedback = profile.feedback || {};
  profile.recent = profile.recent || [];
  profile.events = profile.events || [];
  return profile;
}

export function saveProfile(profile) {
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  atomicWriteJson(profilePath, { ...profile, updatedAt: new Date().toISOString() });
}

export async function importPlaylistText(text) {
  const tracks = parsePlaylistText(text);
  const profile = await importPlaylistTracks(tracks, { resolveUnmatched: true });
  return { ...profile, source: { type: "text", extractedCount: tracks.length } };
}

export async function importPlaylistTracks(tracks, { resolveUnmatched = false } = {}) {
  const graph = loadGraph();
  const importedTracks = [];
  for (const track of normalizeImportedTracks(tracks)) {
    let match = matchSong(graph, track);
    let resolvedTrack = null;
    if (!match && resolveUnmatched) {
      resolvedTrack = await resolvePlayableTrack({ title: track.title, artist: track.artist }).catch(() => null);
      if (resolvedTrack) {
        match = matchSong(graph, {
          title: resolvedTrack.title,
          artist: resolvedTrack.artist
        });
      }
    }
    importedTracks.push({
      ...track,
      match,
      resolvedTrack
    });
  }
  const profile = loadProfile();
  const existing = new Map(profile.importedTracks.map((track) => [`${normalizeSongTitle(track.title)}::${normalizeArtist(track.artist)}`, track]));
  for (const track of importedTracks) {
    existing.set(`${normalizeSongTitle(track.title)}::${normalizeArtist(track.artist)}`, track);
  }
  const nextProfile = {
    ...profile,
    importedTracks: Array.from(existing.values())
  };
  saveProfile(nextProfile);
  return summarizeProfile(nextProfile, graph);
}

function normalizeImportedTracks(tracks = []) {
  const seen = new Set();
  const result = [];
  for (const track of Array.isArray(tracks) ? tracks : []) {
    const title = cleanText(track.title || track.name);
    const artist = cleanText(track.artist || (track.artists || []).map((item) => item.name || item).join(" / "));
    if (!title || !artist) continue;
    const key = `${normalizeSongTitle(title)}::${normalizeArtist(artist)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ title, artist });
    if (result.length >= 120) break;
  }
  return result;
}

export function summarizeProfile(profile = loadProfile(), graph = loadGraph()) {
  const matched = profile.importedTracks.filter((track) => track.match?.songId);
  const resolved = profile.importedTracks.filter((track) => {
    const matchedId = track.match?.songId;
    return track.resolvedTrack?.streamUrl || (matchedId && getCleanPlayableRecord(matchedId, track)?.streamUrl);
  });
  const vectors = buildTasteVectors(profile, graph);
  const recentEvents = (profile.events || []).slice(-80);
  return {
    importedCount: profile.importedTracks.length,
    matchedCount: matched.length,
    resolvedCount: resolved.length,
    unmatched: profile.importedTracks.filter((track) => !track.match?.songId).slice(0, 12),
    topScenes: topValues(vectors.scenes, 8),
    topMoods: topValues(vectors.moods, 8),
    topGenres: topValues(vectors.genres, 8),
    topArtists: topValues(vectors.artists, 8),
    feedbackCount: Object.keys(profile.feedback || {}).length,
    listeningEvents: recentEvents.length,
    completedCount: recentEvents.filter((event) => event.signal === "complete").length,
    skippedCount: recentEvents.filter((event) => event.signal === "skip").length,
    updatedAt: profile.updatedAt
  };
}

export function recommend({ query = "", limit = 16, refreshSeed = "", avoidIds = [] } = {}) {
  const graph = loadGraph();
  const profile = loadProfile();
  const vectors = buildTasteVectors(profile, graph);
  const queryTokens = tokenize(query);
  const avoidSet = new Set((Array.isArray(avoidIds) ? avoidIds : []).map((id) => String(id || "")).filter(Boolean));
  const cleanRefreshSeed = cleanText(refreshSeed);
  const wantsChinese = /华语|中文|国语|粤语|下班|夜晚|松弛/.test(query) || (vectors.languages["华语"] || 0) + (vectors.languages["粤语"] || 0) > 8;
  const anchors = profile.importedTracks
    .map((track) => track.match?.songId && graph.byId.get(track.match.songId))
    .filter(Boolean);
  const scores = new Map();
  const evidence = new Map();

  for (const anchor of anchors) {
    const anchorWeight = Math.max(1, 1 + (profile.feedback?.[anchor.id] || 0) * 0.4);
    addScore(scores, anchor.id, 72 * anchorWeight);
    addEvidence(evidence, anchor.id, "来自你导入的歌单");
    for (const neighbor of anchor.neighbors || []) {
      addScore(scores, neighbor.id, neighbor.weight * 3.2 * anchorWeight);
      addEvidence(evidence, neighbor.id, `和你歌单里的《${anchor.title}》常在同类公开歌单共现`);
    }
  }

  const poolIds = new Set(scores.keys());
  if (poolIds.size < 300) {
    for (const token of queryTokens) {
      for (const id of graph.invertedIndex?.[token] || []) {
        poolIds.add(id);
      }
    }
    for (const song of graph.songs.slice(0, 1200)) {
      poolIds.add(song.id);
      if (poolIds.size > 1400) break;
    }
  }

  const recentIds = new Set((profile.recent || []).slice(-30));
  const ranked = Array.from(poolIds)
    .map((id) => {
      const song = graph.byId.get(id);
      if (!song) return null;
      if (cleanRefreshSeed && avoidSet.has(song.id)) return null;
      let score = scores.get(id) || 0;
      if (isLikelyBadMainSong(song)) return null;
      if (wantsChinese && !isChineseSong(song)) return null;
      score += scoreWeightedOverlap(song.scenes, vectors.scenes, 1.4);
      score += scoreWeightedOverlap(song.moods, vectors.moods, 1.5);
      score += scoreWeightedOverlap(song.genres, vectors.genres, 1.1);
      score += scoreWeightedOverlap(song.languages, vectors.languages, 0.8);
      score += queryTokens.length ? scoreQueryFit(song, queryTokens) : 0;
      score += Math.min(16, song.score * 0.18);
      score += Math.min(10, song.appearances * 0.7);
      const playableRecord = getCleanPlayableRecord(song.id, song);
      score += profile.feedback?.[song.id] || 0;
      if (playableRecord?.streamUrl) score += 18;
      if (hasProviderCandidate(song)) score += 4;
      if (vectors.artists[normalizeArtist(song.artist)]) score += 8;
      if (recentIds.has(song.id)) score -= scores.has(song.id) ? 18 : 45;
      if (cleanRefreshSeed) score += seededJitter(`${cleanRefreshSeed}:${song.id}`, 9);
      return {
        ...song,
        playable: Boolean(playableRecord?.streamUrl),
        recommendScore: Math.round(score * 100) / 100,
        evidence: Array.from(new Set([
          ...(evidence.get(id) || []),
          ...evidenceFromVector(song, vectors, queryTokens)
        ])).slice(0, 4)
      };
    })
    .filter((song) => song && song.recommendScore > 4)
    .sort((left, right) => right.recommendScore - left.recommendScore)
    .slice(0, limit);

  return {
    query,
    anchors: anchors.slice(0, 20).map((song) => ({ id: song.id, title: song.title, artist: song.artist })),
    profile: summarizeProfile(profile, graph),
    recommendations: ranked,
    refreshSeed: cleanRefreshSeed
  };
}

export function recordFeedback(songId, signal) {
  const profile = loadProfile();
  const delta = {
    like: 8,
    dislike: -12,
    skip: -5,
    played: 1,
    complete: 4,
    replay: 3
  }[signal] || 0;
  if (!songId || !delta && !["played", "skip", "complete", "replay"].includes(signal)) {
    return summarizeProfile(profile);
  }
  profile.feedback = profile.feedback || {};
  profile.feedback[songId] = (profile.feedback[songId] || 0) + delta;
  profile.recent = [...(profile.recent || []), songId].slice(-80);
  profile.events = [
    ...(profile.events || []),
    { songId, signal, at: new Date().toISOString() }
  ].slice(-240);
  saveProfile(profile);
  return summarizeProfile(profile);
}

function buildTasteVectors(profile, graph) {
  const vectors = {
    scenes: {},
    moods: {},
    genres: {},
    languages: {},
    artists: {}
  };
  for (const imported of profile.importedTracks || []) {
    const song = imported.match?.songId ? graph.byId.get(imported.match.songId) : null;
    if (!song) continue;
    const feedbackWeight = Math.max(0.2, 1 + (profile.feedback?.[song.id] || 0) * 0.05);
    vectors.artists[normalizeArtist(song.artist)] = (vectors.artists[normalizeArtist(song.artist)] || 0) + 2 * feedbackWeight;
    addVector(vectors.scenes, song.scenes, feedbackWeight);
    addVector(vectors.moods, song.moods, feedbackWeight);
    addVector(vectors.genres, song.genres, feedbackWeight);
    addVector(vectors.languages, song.languages, feedbackWeight);
  }
  return vectors;
}

function addVector(target, weightedValues, factor) {
  for (const item of weightedValues || []) {
    target[item.value] = (target[item.value] || 0) + item.weight * factor;
  }
}

function scoreWeightedOverlap(songValues, vector, factor) {
  let score = 0;
  for (const item of songValues || []) {
    score += Math.min(8, (vector[item.value] || 0) * item.weight * 0.012 * factor);
  }
  return score;
}

function scoreQueryFit(song, tokens) {
  const haystack = `${song.title} ${song.artist} ${song.scenes.map((x) => x.value).join(" ")} ${song.moods.map((x) => x.value).join(" ")} ${song.genres.map((x) => x.value).join(" ")}`.toLowerCase();
  return tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 8 : 0), 0);
}

function evidenceFromVector(song, vectors, queryTokens) {
  const result = [];
  for (const scene of song.scenes || []) {
    if (vectors.scenes[scene.value]) result.push(`场景匹配：${scene.value}`);
  }
  for (const mood of song.moods || []) {
    if (vectors.moods[mood.value]) result.push(`情绪匹配：${mood.value}`);
  }
  for (const genre of song.genres || []) {
    if (vectors.genres[genre.value]) result.push(`曲风匹配：${genre.value}`);
  }
  if (queryTokens.length && scoreQueryFit(song, queryTokens) > 0) result.push("符合这次输入的场景词");
  return result;
}

function parsePlaylistText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    const tracks = Array.isArray(parsed) ? parsed : parsed.tracks || parsed.sampleTracks || [];
    return tracks.map((track) => ({
      title: cleanText(track.title || track.name),
      artist: cleanText(track.artist || (track.artists || []).map((artist) => artist.name || artist).join(" / "))
    })).filter((track) => track.title && track.artist);
  } catch {
    return trimmed
      .split(/\n+/)
      .map((line) => line.replace(/^\s*\d+[.)、-]?\s*/, "").trim())
      .map(parseTrackLine)
      .filter((track) => track.title && track.artist);
  }
}

function parseTrackLine(line) {
  const separators = [" - ", " — ", " – ", "\t", " / "];
  for (const separator of separators) {
    if (line.includes(separator)) {
      const [left, ...rest] = line.split(separator);
      return { title: cleanText(left), artist: cleanText(rest.join(separator)) };
    }
  }
  const match = line.match(/^《([^》]+)》\s*(.+)$/);
  if (match) return { title: cleanText(match[1]), artist: cleanText(match[2]) };
  return { title: cleanText(line), artist: "" };
}

function matchSong(graph, track) {
  const exactId = `${normalizeSongTitle(track.title)}::${normalizeArtist(track.artist)}`;
  if (graph.byId.has(exactId) && !isLikelyBadMainSong(graph.byId.get(exactId))) {
    return { songId: exactId, confidence: 1, method: "exact" };
  }
  const byTitle = (graph.byTitle.get(normalizeSongTitle(track.title)) || [])
    .filter((song) => !isLikelyBadMainSong(song))
    .sort((left, right) => right.score - left.score);
  const artistKey = normalizeArtist(track.artist);
  const artistMatch = byTitle.find((song) => normalizeArtist(song.artist).includes(artistKey) || artistKey.includes(normalizeArtist(song.artist)));
  if (artistMatch) return { songId: artistMatch.id, confidence: 0.9, method: "title_artist_fuzzy" };
  if (artistKey) return null;
  if (byTitle[0]) return { songId: byTitle[0].id, confidence: 0.62, method: "title_only" };
  return null;
}

function addScore(scores, id, delta) {
  scores.set(id, (scores.get(id) || 0) + delta);
}

function addEvidence(evidence, id, text) {
  if (!evidence.has(id)) evidence.set(id, []);
  evidence.get(id).push(text);
}

function topValues(record, limit) {
  return Object.entries(record)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([value, weight]) => ({ value, weight: Math.round(weight * 100) / 100 }));
}

function isLikelyBadMainSong(song) {
  const haystack = `${song.title} ${song.artist}`.toLowerCase();
  return /纯音乐|伴奏|钢琴版|piano|吉他版|guitar|acoustic|cover|翻唱|remix|demo|instrumental|karaoke|八音盒|白噪音|雨声|ost|soundtrack|live|现场|演唱会|电台版|剪辑|片段|试听|dj版/.test(haystack);
}

function isChineseSong(song) {
  const languageValues = (song.languages || []).map((item) => item.value);
  const hasChineseText = /[\u3400-\u9fff]/.test(`${song.title}${song.artist}`);
  if (hasChineseText) return true;
  if (!languageValues.includes("华语") && !languageValues.includes("粤语")) return false;
  return /孙燕姿|陈奕迅|林忆莲|梁静茹|蔡健雅|周杰伦|王菲|田馥甄|五月天|方大同|陶喆|李荣浩|毛不易|邓紫棋|gem|eason|tanya|hebe/i.test(song.artist);
}

function hasProviderCandidate(song) {
  return Array.isArray(song.providerIds) && song.providerIds.some((id) => Number(id) > 0);
}

function tokenize(value) {
  return cleanText(value)
    .toLowerCase()
    .split(/[\s,，.。/|｜:：;；\-_—()[\]【】"'“”‘’]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function seededJitter(seedText, range) {
  return (hashText(seedText) / 0xffffffff - 0.5) * range;
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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

function atomicWriteJson(filePath, value) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
}
