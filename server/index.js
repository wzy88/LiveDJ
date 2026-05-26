import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { EdgeTTS } from "edge-tts-universal";
import { importPlaylistText, loadGraph, loadProfile, recommend, recordFeedback, summarizeProfile } from "./recommender.js";
import { resolvePlayableTrack } from "./music.js";
import { loadPlayableIndex, storePlayableRecord } from "./playable-index.js";
import { buildRadioProgram } from "./radio-program.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const ttsCache = new Map();
const allowedOrigins = new Set(
  [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    process.env.PUBLIC_ORIGIN
  ].filter(Boolean)
);

app.use(express.json({ limit: "3mb" }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  next();
});

app.options("*", (_req, res) => {
  res.sendStatus(204);
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/audio", async (req, res) => {
  try {
    const target = String(req.query.url || "");
    const parsed = new URL(target);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      res.status(400).send("bad audio url");
      return;
    }
    const headers = {};
    if (req.headers.range) {
      headers.Range = req.headers.range;
    }
    const upstream = await fetch(parsed, { headers });
    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status).send("audio upstream failed");
      return;
    }
    res.status(upstream.status);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    if (!res.getHeader("content-type")) {
      res.setHeader("content-type", "audio/mpeg");
    }
    res.setHeader("cache-control", "no-store");
    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body).pipe(res);
  } catch {
    res.status(400).send("audio proxy failed");
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    const text = cleanSpeechText(req.body?.text || "");
    if (!text) {
      res.status(400).json({ error: "missing text" });
      return;
    }
    const voice = cleanText(req.body?.voice || "zh-CN-XiaoxiaoNeural").slice(0, 80);
    const options = {
      rate: cleanText(req.body?.rate || "-8%").slice(0, 12),
      pitch: cleanText(req.body?.pitch || "+6Hz").slice(0, 12),
      volume: cleanText(req.body?.volume || "+0%").slice(0, 12)
    };
    const cacheKey = crypto
      .createHash("sha1")
      .update(JSON.stringify({ text, voice, options }))
      .digest("hex");
    let audioBuffer = ttsCache.get(cacheKey);
    if (!audioBuffer) {
      const tts = new EdgeTTS(text, voice, options);
      const result = await tts.synthesize();
      audioBuffer = Buffer.from(await result.audio.arrayBuffer());
      ttsCache.set(cacheKey, audioBuffer);
      if (ttsCache.size > 80) {
        ttsCache.delete(ttsCache.keys().next().value);
      }
    }
    res.setHeader("content-type", "audio/mpeg");
    res.setHeader("cache-control", "public, max-age=86400");
    res.send(audioBuffer);
  } catch (error) {
    res.status(503).json({ error: `语音生成失败：${error.message}` });
  }
});

app.get("/api/graph/stats", (_req, res) => {
  try {
    const graph = loadGraph();
    res.json({
      generatedAt: graph.generatedAt,
      playlistCount: graph.playlistCount,
      songCount: graph.songCount,
      artistCount: graph.artistCount
    });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.get("/api/profile", (_req, res) => {
  try {
    res.json(summarizeProfile(loadProfile(), loadGraph()));
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.post("/api/profile/import", async (req, res) => {
  try {
    res.json(await importPlaylistText(req.body?.text || ""));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/recommendations", (req, res) => {
  try {
    res.json(recommend({ query: String(req.query.q || ""), limit: Number(req.query.limit || 16) }));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/queue", async (req, res) => {
  try {
    const query = String(req.query.q || "");
    const limit = Math.min(16, Math.max(1, Number(req.query.limit || 8)));
    const preheatLimit = Math.min(32, Math.max(limit * 4, 12));
    const raw = recommend({ query, limit: preheatLimit });
    const queue = [];
    const rejected = [];
    for (const track of raw.recommendations || []) {
      const resolved = await resolvePlayableTrack({
        songId: track.id,
        title: track.title,
        artist: track.artist,
        providerIds: track.providerIds || [],
        durationSec: track.durationSec || null
      }).catch(() => null);
      if (!resolved) {
        rejected.push({ id: track.id, title: track.title, artist: track.artist });
        continue;
      }
      queue.push({
        ...track,
        playable: true,
        resolvedTrack: resolved
      });
      if (queue.length >= limit) break;
    }
    res.json({
      query,
      limit,
      rawCount: (raw.recommendations || []).length,
      queue,
      rejected,
      profile: raw.profile,
      anchors: raw.anchors
    });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

app.get("/api/program", async (req, res) => {
  try {
    const query = String(req.query.q || "");
    const limit = Math.min(10, Math.max(1, Number(req.query.limit || 6)));
    const requestedWait = Number(req.query.wait || 0);
    const maxWaitMs = Number.isFinite(requestedWait) ? Math.min(8000, Math.max(0, requestedWait)) : 0;
    const program = await buildRadioProgram({ query, limit, maxWaitMs });
    res.json(program);
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

app.post("/api/feedback", (req, res) => {
  try {
    res.json(recordFeedback(req.body?.songId, req.body?.signal));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/resolve", async (req, res) => {
  try {
    const track = await resolvePlayableTrack(req.body || {});
    if (!track) {
      res.status(404).json({ error: "没有解析到完整可播音源。可以先运行 npm run dev:music，或换一首候选。" });
      return;
    }
    res.json(track);
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

app.get("/api/playable", (_req, res) => {
  try {
    res.json(loadPlayableIndex());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/playable/verify", async (req, res) => {
  try {
    const tracks = Array.isArray(req.body?.tracks) ? req.body.tracks : [];
    const results = [];
    for (const track of tracks.slice(0, 8)) {
      const resolved = await resolvePlayableTrack(track);
      if (resolved && track.songId) {
        storePlayableRecord(track.songId, resolved);
      }
      results.push({
        songId: track.songId || null,
        title: track.title,
        artist: track.artist,
        playable: Boolean(resolved),
        resolved
      });
    }
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(distDir, "index.html"));
  });
}

function cleanText(value = "") {
  return String(value).replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function cleanSpeechText(value = "") {
  return cleanText(value)
    .replace(/[<>]/g, "")
    .replace(/\s{2,}/g, " ")
    .slice(0, 220);
}

app.listen(port, host, () => {
  console.log(`Claudio Core listening at http://${host}:${port}`);
});
