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
  fs.writeFileSync(playablePath, `${JSON.stringify({ ...index, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

export function getPlayableRecord(songId) {
  return loadPlayableIndex().items?.[songId] || null;
}

export function getCleanPlayableRecord(songId) {
  const record = getPlayableRecord(songId);
  if (!record?.streamUrl || isDirtyPlayableRecord(record) || isStaleNeteaseUrl(record.streamUrl)) return null;
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
  return /live|现场|演唱会|翻唱|翻自|cover|伴奏|纯音乐|钢琴|吉他|demo|片段|试听|karaoke|instrumental|remix|dj版|montagem|电台版|剪辑/.test(haystack);
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
