import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { EdgeTTS } from "edge-tts-universal";
import "./env.js";
import { saveLocalEnv } from "./env.js";
import { importPlaylistText, importPlaylistTracks, loadGraph, loadProfile, recommend, recordFeedback, summarizeProfile } from "./recommender.js";
import { resolvePlayableTrack } from "./music.js";
import { loadPlayableIndex, storePlayableRecord } from "./playable-index.js";
import { buildRadioProgram } from "./radio-program.js";
import { extractTracksFromPlaylistScreenshot, generateDialogueReplyWithLlm, getLlmStatus } from "./llm.js";
import { tracksFromPlaylistUrl } from "./playlist-import.js";
import { proxyAudioRequest } from "./audio-proxy.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const graphPath = path.join(rootDir, "data", "song-graph.json");
const ttsCache = new Map();
let graphBootstrap = {
  state: fs.existsSync(graphPath) ? "ready" : "missing",
  message: fs.existsSync(graphPath) ? "song graph is available" : "song graph is not loaded yet",
  updatedAt: new Date().toISOString()
};
const allowedOrigins = new Set(
  [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    process.env.PUBLIC_ORIGIN
  ].filter(Boolean)
);

app.use(express.json({ limit: "8mb" }));
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
  res.json({ ok: true, graph: graphBootstrap, llm: getLlmStatus() });
});

app.post("/api/llm/config", (req, res) => {
  try {
    const apiKey = cleanText(req.body?.apiKey || req.body?.deepseekApiKey || "");
    const model = cleanText(req.body?.model || "deepseek-chat");
    const apiBase = cleanText(req.body?.apiBase || "https://api.deepseek.com");
    if (!apiKey || apiKey.length < 12) {
      res.status(400).json({ error: "DeepSeek API Key 不能为空。" });
      return;
    }
    if (!/^https?:\/\//i.test(apiBase)) {
      res.status(400).json({ error: "API Base 必须是 http 或 https 地址。" });
      return;
    }
    saveLocalEnv({
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: apiKey,
      DEEPSEEK_API_KEY: apiKey,
      DEEPSEEK_MODEL: model || "deepseek-chat",
      DEEPSEEK_API_BASE: apiBase,
      LLM_MODEL: model || "deepseek-chat",
      LLM_API_BASE: apiBase
    });
    res.json({ llm: getLlmStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/audio", async (req, res) => {
  await proxyAudioRequest({
    target: req.query.url,
    range: req.headers.range || "",
    res
  });
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

app.post("/api/profile/import-link", async (req, res) => {
  try {
    const source = await tracksFromPlaylistUrl(req.body?.url || "");
    const profile = await importPlaylistTracks(source.tracks);
    res.json({ ...profile, source: { type: "link", provider: source.provider, playlistId: source.playlistId, extractedCount: source.tracks.length } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/profile/import-screenshot", async (req, res) => {
  try {
    const tracks = await extractTracksFromPlaylistScreenshot(req.body?.imageDataUrl || "");
    const profile = await importPlaylistTracks(tracks);
    res.json({ ...profile, source: { type: "screenshot", extractedCount: tracks.length } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/recommendations", (req, res) => {
  try {
    res.json(recommend({ query: String(req.query.q || req.query.query || ""), limit: Number(req.query.limit || 16) }));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/queue", async (req, res) => {
  try {
    const query = String(req.query.q || req.query.query || "");
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
    const query = String(req.query.q || req.query.query || "");
    const limit = Math.min(10, Math.max(1, Number(req.query.limit || 6)));
    const requestedWait = Number(req.query.wait || 0);
    const maxWaitMs = Number.isFinite(requestedWait) ? Math.min(8000, Math.max(0, requestedWait)) : 0;
    const refreshSeed = String(req.query.refresh || "");
    const requestedScriptWait = Number(req.query.scriptWait || (refreshSeed ? 9000 : 28000));
    const scriptBudgetMs = Number.isFinite(requestedScriptWait) ? Math.min(32000, Math.max(0, requestedScriptWait)) : 28000;
    const avoidIds = String(req.query.avoid || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 30);
    const program = await buildRadioProgram({ query, limit, maxWaitMs, refreshSeed, avoidIds, scriptBudgetMs });
    res.json(program);
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

app.post("/api/dialogue", async (req, res) => {
  try {
    const profile = loadProfile();
    const summary = (() => {
      try {
        return summarizeProfile(profile, loadGraph());
      } catch {
        return profile;
      }
    })();
    const reply = await generateDialogueReplyWithLlm({
      message: req.body?.message || "",
      query: req.body?.query || "",
      profile: { ...profile, ...summary },
      activeTrack: req.body?.activeTrack || null,
      queue: Array.isArray(req.body?.queue) ? req.body.queue : []
    });
    res.json(reply);
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

const server = app.listen(port, host, () => {
  console.log(`Claudio Core listening at http://${host}:${port}`);
  ensureRuntimeData().catch((error) => {
    graphBootstrap = {
      state: "error",
      message: error.message,
      updatedAt: new Date().toISOString()
    };
    console.warn(`song graph bootstrap failed: ${error.message}`);
  });
  setTimeout(() => {
    warmGraphCache().catch((error) => {
      graphBootstrap = {
        state: "error",
        message: error.message,
        updatedAt: new Date().toISOString()
      };
      console.warn(`song graph warmup failed: ${error.message}`);
    });
  }, 0);
});

server.on("error", (error) => {
  console.error(`Claudio Core server error: ${error.message}`);
});

server.on("close", () => {
  console.warn("Claudio Core server closed.");
});

setInterval(() => {
  // Keep the local dev server alive when launched from background scripts.
}, 60_000);

async function ensureRuntimeData() {
  if (fs.existsSync(graphPath)) {
    graphBootstrap = {
      state: "ready",
      message: "song graph is available",
      updatedAt: new Date().toISOString()
    };
    return;
  }
  const sourceUrl = cleanText(process.env.SONG_GRAPH_URL || "");
  if (!sourceUrl) {
    graphBootstrap = {
      state: "missing",
      message: "song-graph.json is missing and SONG_GRAPH_URL is not configured",
      updatedAt: new Date().toISOString()
    };
    console.warn(graphBootstrap.message);
    return;
  }
  graphBootstrap = {
    state: "downloading",
    message: "downloading song graph",
    updatedAt: new Date().toISOString()
  };
  console.log("Downloading song graph from SONG_GRAPH_URL...");
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    graphBootstrap = {
      state: "error",
      message: `failed to download song graph: ${response.status} ${response.statusText}`,
      updatedAt: new Date().toISOString()
    };
    console.warn(graphBootstrap.message);
    return;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const payload = sourceUrl.endsWith(".gz") || response.headers.get("content-encoding") === "gzip"
    ? gunzipSync(bytes)
    : bytes;
  await fsp.mkdir(path.dirname(graphPath), { recursive: true });
  await fsp.writeFile(graphPath, payload);
  graphBootstrap = {
    state: "ready",
    message: "song graph downloaded",
    updatedAt: new Date().toISOString()
  };
  console.log(`Downloaded song graph to ${graphPath}`);
  await warmGraphCache();
}

async function warmGraphCache() {
  if (!fs.existsSync(graphPath)) return;
  graphBootstrap = {
    state: "loading",
    message: "warming song graph cache",
    updatedAt: new Date().toISOString()
  };
  const graph = loadGraph();
  graphBootstrap = {
    state: "ready",
    message: `song graph ready (${graph.songCount.toLocaleString()} songs)`,
    updatedAt: new Date().toISOString()
  };
}
