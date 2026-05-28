import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const inputPath = process.argv[2] || "data/song-graph.json";
const outputPath = process.argv[3] || "data/song-graph.json.gz";
const limit = Number(process.argv[4] || 12000);

const graph = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const selected = graph.songs.slice(0, limit);
const selectedIds = new Set(selected.map((song) => song.id));

const songs = selected.map((song) => ({
  id: song.id,
  title: song.title,
  artist: song.artist,
  score: song.score,
  appearances: song.appearances,
  scenes: song.scenes,
  moods: song.moods,
  genres: song.genres,
  languages: song.languages,
  neighbors: (song.neighbors || []).filter((neighbor) => selectedIds.has(neighbor.id)).slice(0, 16),
  providerIds: song.providerIds || [],
  durationSec: song.durationSec || null,
  sources: (song.sources || []).slice(0, 4)
}));

const invertedIndex = {};
for (const song of songs) {
  const haystack = [
    song.title,
    song.artist,
    ...(song.scenes || []).map((item) => item.value),
    ...(song.moods || []).map((item) => item.value),
    ...(song.genres || []).map((item) => item.value)
  ].join(" ").toLowerCase();
  for (const token of tokenize(haystack)) {
    if (!invertedIndex[token]) invertedIndex[token] = [];
    invertedIndex[token].push(song.id);
  }
}

const liteGraph = {
  generatedAt: graph.generatedAt,
  sourceSongCount: graph.songCount || graph.songs.length,
  playlistCount: graph.playlistCount,
  songCount: songs.length,
  artistCount: new Set(songs.map((song) => song.artist)).size,
  songs,
  invertedIndex
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, zlib.gzipSync(Buffer.from(JSON.stringify(liteGraph))));

const sizeMb = fs.statSync(outputPath).size / 1024 / 1024;
console.log(`Wrote ${songs.length} songs -> ${outputPath} (${sizeMb.toFixed(1)}MB gz)`);

function tokenize(value) {
  return String(value || "")
    .split(/[\s,，.。/|｜:：;；\-_—()[\]【】"'“”‘’]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}
