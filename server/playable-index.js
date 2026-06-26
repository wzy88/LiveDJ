import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const playablePath = path.join(rootDir, "data", "playable-index.json");

let cache = null;

export function loadPlayableIndex() {
  if (cache) return cache;
  if (!fs.existsSync(playablePath)) {
    cache = { items: {}, updatedAt: null };
    return cache;
  }
  cache = JSON.parse(fs.readFileSync(playablePath, "utf8"));
  cache.items = cache.items || {};
  return cache;
}

export function savePlayableIndex(index = loadPlayableIndex()) {
  cache = index;
  fs.mkdirSync(path.dirname(playablePath), { recursive: true });
  atomicWriteJson(playablePath, { ...index, updatedAt: new Date().toISOString() });
}

export function getPlayableRecord(songId) {
  return loadPlayableIndex().items?.[songId] || null;
}

export function getCleanPlayableRecord(songId, expected = null) {
  const record = getPlayableRecord(songId);
  if (!record?.streamUrl || isDirtyPlayableRecord(record) || isStaleNeteaseUrl(record.streamUrl)) return null;
  if (!isExpectedRecordMatch(songId, record, expected)) return null;
  return record;
}

export function storePlayableRecord(songId, record) {
  const index = loadPlayableIndex();
  index.items[songId] = {
    ...(index.items[songId] || {}),
    ...record,
    updatedAt: new Date().toISOString()
  };
  savePlayableIndex(index);
  return index.items[songId];
}

function isDirtyPlayableRecord(record) {
  const haystack = `${record.title || ""} ${record.artist || ""} ${record.album || ""}`.toLowerCase();
  return /live|现场|演唱会|翻唱|翻自|cover|伴奏|纯音乐|钢琴|piano|吉他|guitar|acoustic|demo|片段|试听|karaoke|instrumental|remix|dj|montagem|电台版|剪辑|改版|伤感版|烟嗓版|降调版|升调版|加速版|慢速版|女声版|男声版|0\.8x|1\.2x/.test(haystack);
}

function isExpectedRecordMatch(songId, record, expected) {
  const parsed = parseSongId(songId);
  const expectedTitle = expected?.title || parsed.title;
  const expectedArtist = expected?.artist || parsed.artist;
  if (!expectedTitle) return true;
  const actualTitleKey = normalizeSongTitle(record.title);
  const expectedTitleKey = normalizeSongTitle(expectedTitle);
  if (!actualTitleKey || !expectedTitleKey) return false;
  const exactTitle = actualTitleKey === expectedTitleKey;
  const containedTitle = actualTitleKey.includes(expectedTitleKey) || expectedTitleKey.includes(actualTitleKey);
  if (!exactTitle && (!containedTitle || looksLikeTitleMedley(actualTitleKey, expectedTitleKey))) return false;
  if (!expectedArtist) return true;
  const actualArtistKey = normalizeArtist(record.artist);
  const expectedArtistKey = normalizeArtist(expectedArtist);
  return !expectedArtistKey || actualArtistKey === expectedArtistKey;
}

function parseSongId(songId = "") {
  const [title = "", artist = ""] = String(songId).split("::");
  return { title, artist };
}

function looksLikeTitleMedley(actualTitleKey, expectedTitleKey) {
  return actualTitleKey.length > Math.max(expectedTitleKey.length + 6, expectedTitleKey.length * 1.8);
}

function isStaleNeteaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!/(^|\.)music\.126\.net$/i.test(parsed.hostname)) return false;
  const match = parsed.pathname.match(/\/(20\d{12})\//);
  if (!match) return false;
  const expiry = parseNeteaseExpiry(match[1]);
  return expiry > 0 && expiry - Date.now() < 10 * 60 * 1000;
}

function parseNeteaseExpiry(value) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return 0;
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 8, Number(minute), Number(second));
}

function normalizeSongTitle(value = "") {
  return normalize(value)
    .replace(/（[^）]*）|\([^)]*\)|【[^】]*】|\[[^\]]*\]/g, "")
    .replace(/live版?|remix版?|cover版?|正式版|原版|录音室版|完整版|新版|旧版/g, "")
    .replace(/[-_·•"'“”‘’.,!?，。！？:：;；\s]/g, "")
    .trim();
}

function normalizeArtist(value = "") {
  return normalize(value)
    .split(/[\/,&，、]| feat\.? | ft\.? /i)[0]
    .replace(/\s+/g, "")
    .trim();
}

function normalize(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, "").trim();
}

function atomicWriteJson(filePath, value) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
}
