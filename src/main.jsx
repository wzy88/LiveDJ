import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const apiBase = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://127.0.0.1:8787" : "");

function App() {
  const [graphStats, setGraphStats] = useState(null);
  const [profile, setProfile] = useState(null);
  const [importMode, setImportMode] = useState("link");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [playlistText, setPlaylistText] = useState("");
  const [playlistImageDataUrl, setPlaylistImageDataUrl] = useState("");
  const [playlistImageName, setPlaylistImageName] = useState("");
  const [query, setQuery] = useState("今晚下班路上，想听一点华语、松弛、但不要太丧");
  const [promptText, setPromptText] = useState("今晚下班路上，想听一点华语、松弛、但不要太丧");
  const [recommendations, setRecommendations] = useState([]);
  const [activeTrack, setActiveTrack] = useState(null);
  const [resolvedTrack, setResolvedTrack] = useState(null);
  const [status, setStatus] = useState("正在读取歌曲图谱...");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [isPlaying, setIsPlaying] = useState(false);
  const [isNarrating, setIsNarrating] = useState(false);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isImportPanelOpen, setIsImportPanelOpen] = useState(false);
  const [isLlmPanelOpen, setIsLlmPanelOpen] = useState(false);
  const [isSavingLlm, setIsSavingLlm] = useState(false);
  const [llmStatus, setLlmStatus] = useState(null);
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmModel, setLlmModel] = useState("deepseek-chat");
  const [llmApiBase, setLlmApiBase] = useState("https://api.deepseek.com");
  const [musicVolume, setMusicVolume] = useState(0.88);
  const [djLine, setDjLine] = useState("把你的想法丢给我，我来接歌。");
  const [currentTalkSegment, setCurrentTalkSegment] = useState(null);
  const [dialogueMessages, setDialogueMessages] = useState([
    { id: "dj-initial", role: "dj", text: "把你的想法丢给我，我来接歌。" }
  ]);

  const audioRef = useRef(null);
  const voiceRef = useRef(null);
  const voiceUrlRef = useRef("");
  const queueRef = useRef([]);
  const talkTimersRef = useRef([]);
  const silentUrlRef = useRef("");
  const programPromiseRef = useRef(null);
  const deepProgramPromiseRef = useRef(null);
  const speechSeqRef = useRef(0);
  const latestQueryRef = useRef(query);
  const activeTrackRef = useRef(activeTrack);
  const dialogueEndRef = useRef(null);
  const scheduledTalkTrackIdRef = useRef("");
  const playedFeedbackRef = useRef(new Set());

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    queueRef.current = recommendations;
  }, [recommendations]);

  useEffect(() => {
    latestQueryRef.current = query;
  }, [query]);

  useEffect(() => {
    activeTrackRef.current = activeTrack;
  }, [activeTrack]);

  useEffect(() => {
    dialogueEndRef.current?.scrollIntoView({ block: "end" });
  }, [dialogueMessages]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const sync = () => {
      setIsPlaying(Boolean(!audio.paused && !audio.ended));
    };
    audio.addEventListener("play", sync);
    audio.addEventListener("pause", sync);
    audio.addEventListener("ended", sync);
    sync();
    return () => {
      audio.removeEventListener("play", sync);
      audio.removeEventListener("pause", sync);
      audio.removeEventListener("ended", sync);
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      const duckVolume = currentTalkSegment?.musicVolume ?? 0.24;
      audioRef.current.volume = isNarrating ? Math.min(musicVolume, duckVolume) : musicVolume;
    }
  }, [currentTalkSegment, isNarrating, musicVolume]);

  useEffect(() => {
    return () => stopSpeechAndTimers();
  }, []);

  async function refreshAll() {
    const [health, stats, profileResult] = await Promise.all([
      fetchJson("/api/health").catch(() => null),
      fetchJson("/api/graph/stats").catch((error) => ({ error: error.message })),
      fetchJson("/api/profile").catch(() => null)
    ]);
    setLlmStatus(health?.llm || null);
    setGraphStats(stats);
    setProfile(profileResult);
    if (stats?.error) {
      setStatus("还没有歌曲图谱，请先运行 npm run graph:build。");
      return;
    }
    setStatus(`已加载 ${stats.songCount.toLocaleString()} 首歌曲画像。`);
    await loadRecommendations();
  }

  async function importPlaylist() {
    setIsImporting(true);
    setStatus("正在把你的歌单映射到歌曲图谱...");
    try {
      const result = importMode === "screenshot"
        ? await importPlaylistScreenshot()
        : importMode === "text"
          ? await importPlaylistText()
          : await importPlaylistLink();
      const extractedCount = result.source?.extractedCount || result.importedCount || 0;
      setProfile(result);
      appendDialogueMessage("user", importMode === "screenshot" ? "上传了一张歌单截图" : importMode === "text" ? "粘贴了一段歌单文字" : "导入了一个歌单链接");
      appendDialogueMessage("dj", buildImportSummary(result, extractedCount));
      setStatus(`导入 ${extractedCount} 首，图谱匹配 ${result.matchedCount} 首；我会用这些口味信号找稳定可播的队列。`);
      await loadRecommendations("根据我刚导入的歌单，排一段最贴近我口味的电台", { appendDjResponse: true });
      setIsImportPanelOpen(false);
    } catch (error) {
      setStatus(`歌单导入失败：${error.message}`);
      appendDialogueMessage("dj", `歌单导入失败：${error.message}`);
    } finally {
      setIsImporting(false);
    }
  }

  async function saveLlmConfig() {
    setIsSavingLlm(true);
    setStatus("正在保存 DeepSeek 配置...");
    try {
      const result = await fetchJson("/api/llm/config", {
        method: "POST",
        body: JSON.stringify({
          apiKey: llmApiKey,
          model: llmModel,
          apiBase: llmApiBase
        })
      });
      setLlmStatus(result.llm);
      setLlmApiKey("");
      setIsLlmPanelOpen(false);
      setStatus(result.llm?.configured ? `DeepSeek 已连接：${result.llm.model}` : "DeepSeek 配置未生效。");
      appendDialogueMessage("dj", "DeepSeek 已经接上了。之后我的闲聊和口播会优先走模型，不再靠本地模板硬撑。");
    } catch (error) {
      setStatus(`DeepSeek 保存失败：${error.message}`);
    } finally {
      setIsSavingLlm(false);
    }
  }

  async function importPlaylistLink() {
    const url = playlistUrl.trim();
    if (!url) throw new Error("请先粘贴歌单链接。");
    return fetchJson("/api/profile/import-link", {
      method: "POST",
      body: JSON.stringify({ url })
    });
  }

  async function importPlaylistText() {
    const text = playlistText.trim();
    if (!text) throw new Error("请先粘贴歌单文字，每行像“歌名 - 歌手”。");
    return fetchJson("/api/profile/import", {
      method: "POST",
      body: JSON.stringify({ text })
    });
  }

  async function importPlaylistScreenshot() {
    if (!playlistImageDataUrl) throw new Error("请先上传歌单截图。");
    return fetchJson("/api/profile/import-screenshot", {
      method: "POST",
      body: JSON.stringify({ imageDataUrl: playlistImageDataUrl })
    });
  }

  function handlePlaylistImageChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      setStatus("请上传 PNG、JPG 或 WebP 截图。");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setStatus("截图太大了，请上传 4MB 以内的图片。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPlaylistImageDataUrl(String(reader.result || ""));
      setPlaylistImageName(file.name);
    };
    reader.readAsDataURL(file);
  }

  async function loadRecommendations(queryOverride = query, options = {}) {
    const effectiveQuery = String(queryOverride || "").trim();
    if (!programPromiseRef.current) {
      programPromiseRef.current = fetchJson(`/api/program?q=${encodeURIComponent(effectiveQuery)}&limit=10&wait=6500`).finally(() => {
        programPromiseRef.current = null;
      });
    }
    setStatus("正在生成可播队列...");
    setIsLoadingQueue(true);
    try {
      const result = await programPromiseRef.current;
      const nextQueue = result.queue || [];
      setRecommendations(nextQueue);
      queueRef.current = nextQueue;
      setProfile(result.profile || profile);
      if (nextQueue[0]) {
        setCurrentIndex(0);
        setActiveTrack(nextQueue[0]);
        setResolvedTrack(nextQueue[0].resolvedTrack || null);
        setDjLine(nextQueue[0].script?.opening || "新的电台队列已经排好。");
        if (options.appendDjResponse) {
          appendDialogueMessage("dj", nextQueue[0].script?.opening || "我按这句话重新排好了。");
        }
        prewarmScriptAudio(nextQueue);
      } else {
        setActiveTrack(null);
        setResolvedTrack(null);
        setDjLine("这次没有找到稳定可播的歌。我会更保守一点，你也可以换个状态词或者导入更多歌。");
      }
      setStatus(nextQueue.length ? `可播队列已生成：${nextQueue.length} 首可直接播放，后台继续补齐队列。` : "这次候选都没有通过可播验证，正在后台继续补。");
      if (nextQueue.length < 8) {
        fillQueueInBackground(effectiveQuery, nextQueue.length);
      }
      return result;
    } finally {
      setIsLoadingQueue(false);
    }
  }

  async function fillQueueInBackground(querySnapshot, currentCount) {
    if (deepProgramPromiseRef.current) return;
    deepProgramPromiseRef.current = fetchJson(`/api/program?q=${encodeURIComponent(querySnapshot)}&limit=10&wait=7000`).finally(() => {
      deepProgramPromiseRef.current = null;
    });
    const result = await deepProgramPromiseRef.current.catch(() => null);
    if (!result || querySnapshot !== latestQueryRef.current) return;
    const nextQueue = result.queue || [];
    if (nextQueue.length <= currentCount) return;
    setRecommendations(nextQueue);
    queueRef.current = nextQueue;
    setProfile((current) => result.profile || current);
    if (activeTrackRef.current) {
      const refreshedActive = nextQueue.find((track) => track.id === activeTrackRef.current.id);
      if (refreshedActive) setActiveTrack(refreshedActive);
    }
    prewarmScriptAudio(nextQueue);
    setStatus(`后台补齐完成：现在有 ${nextQueue.length} 首可播。`);
  }

  async function playSelectedTrack(track = activeTrack) {
    if (!track) return;
    const index = queueRef.current.findIndex((item) => item.id === track.id);
    if (track.resolvedTrack && index >= 0) {
      await playTrackAtIndex(index, queueRef.current);
      return;
    }
    primeAudioElement();
    setActiveTrack(track);
    setResolvedTrack(null);
    setStatus(`正在验证可播音源：${track.title} - ${track.artist}`);
    const resolved = await fetchJson("/api/resolve", {
      method: "POST",
      body: JSON.stringify({
        songId: track.id,
        title: track.title,
        artist: track.artist,
        providerIds: track.providerIds || [],
        durationSec: track.durationSec || null
      })
    }).catch((error) => ({ error: error.message }));
    if (resolved.error) {
      setStatus(resolved.error);
      return;
    }
    setResolvedTrack(resolved);
    setStatus(`已解析完整音源：${resolved.title} - ${resolved.artist}`);
    if (audioRef.current) {
      audioRef.current.src = toAudioSource(resolved.streamUrl);
      audioRef.current.load();
      audioRef.current.muted = false;
      audioRef.current.volume = musicVolume;
      try {
        await playMusicAudio(audioRef.current);
        setIsPlaying(true);
      } catch (error) {
        setStatus(`播放失败：${error.message}。请再点一次播放，或换一首 READY 歌曲。`);
      }
    }
    await markPlayed(track.id);
  }

  async function startRadio() {
    if (recommendations?.[0]) {
      await playTrackAtIndex(0, recommendations);
      return;
    }
    if (!isLoadingQueue) {
      loadRecommendations();
    }
    setStatus("正在准备可播队列，READY 后再点播放。");
  }

  async function playTrackAtIndex(index, queue = queueRef.current) {
    const safeIndex = index < 0 ? 0 : index;
    const track = queue[safeIndex];
    if (!track?.resolvedTrack) {
      setStatus("这首还没有准备好可播音源。");
      return;
    }
    stopSpeechAndTimers();
    setCurrentIndex(safeIndex);
    setActiveTrack(track);
    setResolvedTrack(track.resolvedTrack);
    setDjLine(track.script?.opening || `正在播放《${track.title}》。`);
    setStatus(`正在播放：${track.title} - ${track.artist}`);
    if (audioRef.current) {
      audioRef.current.src = toAudioSource(track.resolvedTrack.streamUrl);
      audioRef.current.loop = false;
      audioRef.current.muted = false;
      audioRef.current.preload = "auto";
      audioRef.current.volume = musicVolume;
      try {
        await playMusicAudio(audioRef.current);
        setIsPlaying(true);
      } catch (error) {
        setStatus(`播放失败：${error.message}。请再点一次播放，或换一首 READY 歌曲。`);
        setIsPlaying(false);
        return;
      }
    }
    scheduleTalkover(track);
    await markPlayed(track.id);
  }

  async function handleTrackEnded() {
    stopSpeechAndTimers();
    if (activeTrack?.id) {
      sendFeedback(activeTrack.id, "complete", false).catch(() => {});
    }
    const nextIndex = currentIndex + 1;
    const queue = queueRef.current;
    if (queue[nextIndex]) {
      await playTrackAtIndex(nextIndex, queue);
      return;
    }
    const program = await loadRecommendations();
    if (program?.queue?.[0]) {
      await playTrackAtIndex(0, program.queue);
    }
  }

  function stopSpeechAndTimers() {
    speechSeqRef.current += 1;
    talkTimersRef.current.forEach((timer) => clearTimeout(timer));
    talkTimersRef.current = [];
    scheduledTalkTrackIdRef.current = "";
    if (voiceRef.current) {
      voiceRef.current.pause();
      voiceRef.current.onended = null;
      voiceRef.current.onerror = null;
    }
    if (voiceUrlRef.current) {
      URL.revokeObjectURL(voiceUrlRef.current);
      voiceUrlRef.current = "";
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsNarrating(false);
    setCurrentTalkSegment(null);
  }

  function primeAudioElement() {
    if (!audioRef.current) return;
    if (!silentUrlRef.current) {
      silentUrlRef.current = createSilentWavUrl();
    }
    audioRef.current.src = silentUrlRef.current;
    audioRef.current.muted = true;
    audioRef.current.loop = true;
    audioRef.current.play().catch(() => {});
  }

  function createSilentWavUrl() {
    const sampleRate = 8000;
    const seconds = 1;
    const samples = sampleRate * seconds;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + samples * 2, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, samples * 2, true);
    return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  }

  function writeAscii(view, offset, text) {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  }

  function toAudioSource(url) {
    if (!url) return "";
    if (url.startsWith(apiBase) || url.startsWith("data:") || url.startsWith("blob:")) return url;
    return `${apiBase}/api/audio?url=${encodeURIComponent(url)}`;
  }

  async function playMusicAudio(audio) {
    try {
      audio.muted = false;
      await audio.play();
      return;
    } catch (error) {
      if (!/interact|gesture|allowed|permission/i.test(error.message || "")) {
        throw error;
      }
      audio.muted = true;
      await audio.play();
      window.setTimeout(() => {
        audio.muted = false;
        audio.volume = isNarrating ? Math.min(musicVolume, currentTalkSegment?.musicVolume ?? 0.24) : musicVolume;
      }, 80);
    }
  }

  function scheduleTalkover(track) {
    const script = track.script;
    if (!script) return;
    if (scheduledTalkTrackIdRef.current === track.id) return;
    scheduledTalkTrackIdRef.current = track.id;
    const durationMs = Math.max(120000, Math.round((track.resolvedTrack?.durationSec || track.durationSec || 220) * 1000));
    const stages = Array.isArray(script.stages) && script.stages.length
      ? script.stages
      : buildFallbackTalkStages(script, track);
    stages.forEach((stage) => {
      const offset = resolveTalkOffset(stage, durationMs);
      if (!Number.isFinite(offset) || offset < 0 || offset > durationMs - 2500) return;
      talkTimersRef.current.push(
        window.setTimeout(() => speakOverMusic(stage.text, stage), Math.max(0, offset))
      );
    });
  }

  function buildFallbackTalkStages(script, track) {
    return [
      { id: `${track.id}:intro`, type: "intro", label: "口播 1/3", text: script.opening, position: "start", offsetMs: 1400, musicVolume: 0.22 },
      { id: `${track.id}:bridge-a`, type: "bridge", label: "口播 2/3", text: script.bridges?.[0], position: "percent", percent: 0.31, minMs: 26000, maxBeforeEndMs: 65000, musicVolume: 0.2 },
      { id: `${track.id}:bridge-b`, type: "bridge", label: "口播 3/3", text: script.bridges?.[1], position: "percent", percent: 0.64, minMs: 62000, maxBeforeEndMs: 26000, musicVolume: 0.2 },
      { id: `${track.id}:next-tease`, type: "next", label: "下一首串联", text: script.nextTease, position: "beforeEnd", beforeEndMs: 15000, minMs: 90000, musicVolume: 0.18 }
    ].filter((stage) => stage.text);
  }

  function resolveTalkOffset(stage, durationMs) {
    if (!stage) return null;
    if (stage.position === "beforeEnd") {
      const preferred = durationMs - (stage.beforeEndMs || 15000);
      return Math.max(stage.minMs || 0, preferred);
    }
    if (stage.position === "percent") {
      const byPercent = durationMs * (Number(stage.percent) || 0.35);
      const min = stage.minMs || 0;
      const max = durationMs - (stage.maxBeforeEndMs || 20000);
      return Math.min(Math.max(min, byPercent), max);
    }
    return stage.offsetMs || 0;
  }

  async function speakOverMusic(text, segment = null) {
    if (typeof window === "undefined" || !text) return;
    const token = ++speechSeqRef.current;
    const nextSegment = segment ? { ...segment, text } : { id: `manual-${token}`, type: "manual", label: "口播", text, musicVolume: 0.22 };
    setCurrentTalkSegment(nextSegment);
    setDjLine(text);
    setStatus("正在准备口播...");
    try {
      if (voiceRef.current) {
        voiceRef.current.pause();
      }
      const response = await fetch(`${apiBase}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: "zh-CN-XiaoxiaoNeural",
          rate: "-10%",
          pitch: "+6Hz",
          volume: "+0%"
        })
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const blob = await response.blob();
      if (token !== speechSeqRef.current) return;
      const url = URL.createObjectURL(blob);
      if (voiceUrlRef.current) {
        URL.revokeObjectURL(voiceUrlRef.current);
      }
      voiceUrlRef.current = url;
      const voiceAudio = voiceRef.current || new Audio();
      voiceRef.current = voiceAudio;
      voiceAudio.src = url;
      voiceAudio.volume = 1;
      voiceAudio.onplaying = () => {
        if (token !== speechSeqRef.current) return;
        setIsNarrating(true);
        setStatus(`${nextSegment.label || "口播"}中...`);
      };
      voiceAudio.onended = () => {
        if (token !== speechSeqRef.current) return;
        setIsNarrating(false);
        setCurrentTalkSegment(null);
        setStatus("电台继续播放中。");
        if (voiceUrlRef.current) {
          URL.revokeObjectURL(voiceUrlRef.current);
          voiceUrlRef.current = "";
        }
      };
      voiceAudio.onerror = () => {
        if (token !== speechSeqRef.current) return;
        setIsNarrating(false);
        setCurrentTalkSegment(null);
        setStatus("口播播放失败，已回到音乐。");
      };
      await voiceAudio.play();
    } catch (error) {
      if (token !== speechSeqRef.current) return;
      if (typeof window.speechSynthesis !== "undefined") {
        playFallbackSpeech(text, token);
        return;
      }
      setIsNarrating(false);
      setCurrentTalkSegment(null);
      setStatus(`口播失败：${error.message}`);
    }
  }

  function playFallbackSpeech(text, token) {
    const fallbackSegment = currentTalkSegment || { id: `fallback-${token}`, type: "fallback", label: "口播", text, musicVolume: 0.22 };
    setCurrentTalkSegment(fallbackSegment);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((item) => /zh|cmn/i.test(`${item.lang} ${item.name}`)) || voices.find((item) => /中文|普通话|mandarin/i.test(item.name)) || voices[0];
    if (voice) utterance.voice = voice;
    utterance.onstart = () => {
      if (token !== speechSeqRef.current) return;
      setIsNarrating(true);
      setStatus(`${fallbackSegment.label || "口播"}中...`);
    };
    utterance.onend = () => {
      if (token !== speechSeqRef.current) return;
      setIsNarrating(false);
      setCurrentTalkSegment(null);
      setStatus("电台继续播放中。");
    };
    utterance.onerror = () => {
      if (token !== speechSeqRef.current) return;
      setIsNarrating(false);
      setCurrentTalkSegment(null);
      setStatus("口播播放失败，已回到音乐。");
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function prewarmScriptAudio(queue) {
    const lines = queue
      .slice(0, 2)
      .flatMap((track) => (track.script?.stages || [{ text: track.script?.opening }]).map((stage) => stage.text))
      .filter(Boolean);
    for (const line of lines.slice(0, 5)) {
      fetch(`${apiBase}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: line,
          voice: "zh-CN-XiaoxiaoNeural",
          rate: "-10%",
          pitch: "+6Hz",
          volume: "+0%"
        })
      }).catch(() => {});
    }
  }

  async function replayCurrentTalk() {
    const segment = currentTalkSegment || activeTrack?.script?.stages?.[0] || null;
    const text = segment?.text || djLine;
    if (!text) return;
    await speakOverMusic(text, segment || { id: "manual-replay", label: "重说口播", text, musicVolume: 0.22 });
    if (activeTrack?.id) sendFeedback(activeTrack.id, "replay", false).catch(() => {});
  }

  async function likeCurrentTrack() {
    if (!activeTrack?.id) return;
    await sendFeedback(activeTrack.id, "like", false);
    setStatus(`记住了：以后多放一点像《${activeTrack.title}》这样的歌。`);
    appendDialogueMessage("dj", `好，我会把《${activeTrack.title}》这一类权重调高一点。`);
  }

  async function dislikeCurrentTrack() {
    if (!activeTrack?.id) return;
    await sendFeedback(activeTrack.id, "dislike", false);
    setStatus(`收到：以后少放一点像《${activeTrack.title}》这样的歌。`);
    appendDialogueMessage("dj", `收到，这类我会少放一点，下一首换个方向。`);
    await handleNext();
  }

  function skipCurrentTalk() {
    if (!isNarrating && !currentTalkSegment) return;
    stopSpeechAndTimers();
    setStatus("已跳过当前口播，音乐继续。");
  }

  async function sendFeedback(songId, signal, reload = true) {
    const result = await fetchJson("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ songId, signal })
    });
    setProfile(result);
    if (reload) await loadRecommendations();
  }

  async function markPlayed(songId) {
    if (!songId || playedFeedbackRef.current.has(songId)) return;
    playedFeedbackRef.current.add(songId);
    await sendFeedback(songId, "played", false);
  }

  function handleNativeAudioPlay() {
    setIsPlaying(true);
    if (!activeTrack?.resolvedTrack) return;
    scheduleTalkover(activeTrack);
    markPlayed(activeTrack.id).catch(() => {});
  }

  async function handlePromptSubmit(event) {
    event.preventDefault();
    const nextQuery = promptText.trim();
    if (!nextQuery) return;
    appendDialogueMessage("user", nextQuery);
    setPromptText("");
    const dialogue = await fetchJson("/api/dialogue", {
      method: "POST",
      body: JSON.stringify({
        message: nextQuery,
        query,
        activeTrack,
        queue: queueRef.current.slice(0, 8)
      })
    }).catch(() => ({
      intent: /想听|放|播|来点|换歌|歌单|华语|粤语|下班|通勤|睡觉|失眠|emo|松弛/i.test(nextQuery) ? "music" : "chat",
      reply: "我在。你这句我收到了。"
    }));
    if (dialogue?.reply) {
      appendDialogueMessage("dj", dialogue.reply);
      setDjLine(dialogue.reply);
    }
    if (dialogue.intent === "chat") {
      setStatus(dialogue.source === "llm" ? "Claudio 已回复。" : "Claudio 已用本地兜底回复。");
      return;
    }
    stopSpeechAndTimers();
    programPromiseRef.current = null;
    deepProgramPromiseRef.current = null;
    setQuery(nextQuery);
    latestQueryRef.current = nextQuery;
    await loadRecommendations(nextQuery, { appendDjResponse: true });
  }

  function appendDialogueMessage(role, text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    setDialogueMessages((current) => [
      ...current.slice(-7),
      {
        id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        role,
        text: clean
      }
    ]);
  }

  async function handleTransportPlay() {
    if (!activeTrack) {
      await startRadio();
      return;
    }
    if (!activeTrack.resolvedTrack) {
      setStatus("这首还在解析音源，READY 后再点播放。");
      return;
    }
    if (!isPlaying) {
      const activeIndex = queueRef.current.findIndex((track) => track.id === activeTrack.id);
      if (activeTrack.resolvedTrack && activeIndex >= 0) {
        await playTrackAtIndex(activeIndex, queueRef.current);
        return;
      }
      await playSelectedTrack(activeTrack);
      return;
    }
    audioRef.current?.pause();
  }

  async function handlePrevious() {
    const nextIndex = Math.max(0, currentIndex - 1);
    const track = queueRef.current[nextIndex];
    if (track) await playTrackAtIndex(nextIndex, queueRef.current);
  }

  async function handleNext() {
    if (activeTrack?.id && isPlaying) {
      sendFeedback(activeTrack.id, "skip", false).catch(() => {});
    }
    const nextIndex = currentIndex + 1;
    const queue = queueRef.current;
    if (queue[nextIndex]) {
      await playTrackAtIndex(nextIndex, queue);
      return;
    }
    const program = await loadRecommendations();
    if (program?.queue?.[0]) {
      await playTrackAtIndex(0, program.queue);
    }
  }

  const profileText = useMemo(() => {
    if (!profile) return "暂无画像";
    const unmatched = (profile.unmatched || []).slice(0, 5).map((track) => `未匹配：${track.title} - ${track.artist}`);
    return [
      `导入 ${profile.importedCount || 0} 首 / 匹配 ${profile.matchedCount || 0} 首`,
      profile.resolvedCount ? `导入歌已确认可播 ${profile.resolvedCount} 首` : "导入歌会作为口味信号，队列会优先找稳定可播版本",
      profile.topScenes?.length ? `场景 ${profile.topScenes.map((x) => x.value).join("、")}` : "",
      profile.topMoods?.length ? `情绪 ${profile.topMoods.map((x) => x.value).join("、")}` : "",
      profile.topGenres?.length ? `曲风 ${profile.topGenres.map((x) => x.value).join("、")}` : "",
      ...unmatched
    ].filter(Boolean).join("\n");
  }, [profile]);

  const tasteSummary = profile?.importedCount
    ? `已导入 ${profile.importedCount} 首，匹配 ${profile.matchedCount || 0} 首`
    : "导入歌单后，电台会优先按你的口味接歌";

  function queueMetaFor(track) {
    if (track.evidence?.some((item) => item.includes("来自你导入的歌单"))) return "你的歌单";
    if (track.scriptSource === "llm") return "DJ";
    if (track.script?.stages?.length) return `${track.script.stages.length} 段`;
    return track.playable ? "READY" : "准备中";
  }

  return (
    <main className="appShell">
      <section className="stage">
        <div className="deviceFrame">
          <header className="deviceTop">
            <div>
              <p className="eyebrow">Claudio</p>
              <h1>今晚先听点像人的电台</h1>
              <p className="tasteSummary">{tasteSummary}</p>
            </div>
            <div className="topActions">
              <button
                type="button"
                className={llmStatus?.configured ? "llmStatusButton connected" : "llmStatusButton"}
                onClick={() => setIsLlmPanelOpen(true)}
              >
                {llmStatus?.configured ? `DeepSeek · ${llmStatus.model}` : "连接 DeepSeek"}
              </button>
              <button type="button" className="importEntryButton" onClick={() => setIsImportPanelOpen(true)}>
                导入歌单
              </button>
            </div>
          </header>

          <div className="clockPanel">
            <div className="clockDigits">{formatClock(clock)}</div>
            <div className="clockMeta">
              <div>{formatWeekday(clock)}</div>
              <div>{formatDate(clock)}</div>
              <div className="onAir">
                <span className="liveDot" />
                ON AIR
              </div>
            </div>
          </div>

          <div className="nowRail">
            <div className="cover">
              {resolvedTrack?.coverUrl ? <img src={resolvedTrack.coverUrl} alt="" /> : <span>{activeTrack ? activeTrack.title.slice(0, 2) : "C"}</span>}
            </div>
            <div className="nowCopy">
              <p className="label">Now Playing</p>
              <h2>{activeTrack?.title || "等待推荐"}</h2>
              <p className="artistLine">{activeTrack?.artist || "导入歌单后开始"}</p>
              <div className="scoreLine">
                <span>{resolvedTrack || activeTrack?.playable ? "可播放" : "准备中"}</span>
                <span>{isNarrating ? "口播中" : isPlaying ? "播放中" : "待播放"}</span>
              </div>
            </div>
            <div className="transport">
              <button type="button" onClick={handlePrevious} aria-label="上一首">◀</button>
              <button
                type="button"
                className="transportMain"
                onClick={handleTransportPlay}
                disabled={isLoadingQueue || Boolean(activeTrack && !activeTrack.resolvedTrack)}
                aria-label={isPlaying ? "暂停" : "播放"}
              >
                {isPlaying ? "Ⅱ" : "▶"}
              </button>
              <button type="button" onClick={handleNext} aria-label="下一首">▶</button>
            </div>
            <div className="volumeRow">
              <span>VOL</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={musicVolume}
                onChange={(event) => setMusicVolume(Number(event.target.value))}
              />
            </div>
          </div>

          <audio
            ref={audioRef}
            className="nativeAudioPlayer"
            controls={Boolean(resolvedTrack?.streamUrl)}
            src={resolvedTrack?.streamUrl ? toAudioSource(resolvedTrack.streamUrl) : undefined}
            onPlay={handleNativeAudioPlay}
            onEnded={handleTrackEnded}
            preload="auto"
            playsInline
          />

          <div className="liveDjPanel">
            <div className="liveDjCopy">
              <p className="label">{currentTalkSegment?.label || "Live DJ"}</p>
              <p>{djLine}</p>
            </div>
            <div className="talkControls">
              <button type="button" onClick={likeCurrentTrack} disabled={!activeTrack}>
                喜欢
              </button>
              <button type="button" onClick={dislikeCurrentTrack} disabled={!activeTrack}>
                少来
              </button>
              <button type="button" onClick={replayCurrentTalk} disabled={!djLine}>
                重说
              </button>
              <button type="button" onClick={skipCurrentTalk} disabled={!isNarrating && !currentTalkSegment}>
                跳过口播
              </button>
            </div>
          </div>

          <div className="handwrittenBlock">
            <span className="handwritten">what's next on your mind</span>
            <span className="handwrittenCn">你接下来在想什么</span>
          </div>

          <div className="dialoguePanel">
            <div className="dialogueStack" aria-live="polite">
              {dialogueMessages.map((message) => (
                <div className={message.role === "user" ? "messageRow userMessageRow" : "messageRow"} key={message.id}>
                  {message.role === "dj" ? <div className="messageAvatar">C</div> : null}
                  <div className={message.role === "user" ? "messageBubble userMessageBubble" : "messageBubble"}>
                    <p>{message.text}</p>
                  </div>
                  {message.role === "user" ? <div className="messageAvatar userAvatar">我</div> : null}
                </div>
              ))}
              <div ref={dialogueEndRef} />
            </div>

            <form className="promptRow" onSubmit={handlePromptSubmit}>
              <input value={promptText} onChange={(event) => setPromptText(event.target.value)} placeholder={query || "跟 Claudio 说一句..."} />
              <button type="submit" aria-label="生成队列">→</button>
            </form>

            <div className="footerBar">
              <span>CLAUDIO FM</span>
              <span>{isNarrating ? "TALKING" : isLoadingQueue ? "TUNING" : llmStatus?.configured ? "DEEPSEEK" : "RULES"}</span>
            </div>
            <p className="statusLine">{status}</p>
          </div>

          <div className="queuePanel">
            <div className="queueHead">
              <div>
                <p className="label">Queue</p>
                <h3>接下来要播什么</h3>
              </div>
              <div className="queueActions">
                <button type="button" onClick={() => loadRecommendations()}>重排</button>
              </div>
            </div>
            <div className="queueList">
              {isLoadingQueue && !recommendations.length ? (
                <>
                  <div className="queueSkeleton" />
                  <div className="queueSkeleton" />
                  <div className="queueSkeleton" />
                </>
              ) : null}
              {recommendations.map((track, index) => (
                <button
                  className={activeTrack?.id === track.id ? "queueRow active" : "queueRow"}
                  key={track.id}
                  type="button"
                  onClick={() => playTrackAtIndex(index, recommendations)}
                >
                  <span className="queueIndex">{String(index + 1).padStart(2, "0")}</span>
                  <span className="queueBody">
                    <strong>{track.title}</strong>
                    <small>{track.artist}</small>
                  </span>
                  <span className="queueMeta">
                    {queueMetaFor(track)}
                  </span>
                </button>
              ))}
              {!isLoadingQueue && !recommendations.length ? (
                <div className="emptyQueue">
                  <strong>还没有稳定可播的队列</strong>
                  <span>换一句状态，或导入你的歌单，我会重新找能播且贴近的歌。</span>
                </div>
              ) : null}
            </div>
          </div>

        </div>
      </section>

      {isImportPanelOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="playlist-import-title">
          <div className="playlistModal">
            <div className="modalHead">
              <div>
                <p className="label">Taste Source</p>
                <h2 id="playlist-import-title">导入你的歌单</h2>
              </div>
              <button type="button" className="iconButton" onClick={() => setIsImportPanelOpen(false)} aria-label="关闭导入面板">
                ×
              </button>
            </div>
            <div className="importSwitch" role="tablist" aria-label="歌单导入方式">
              <button type="button" className={importMode === "link" ? "active" : ""} onClick={() => setImportMode("link")}>链接</button>
              <button type="button" className={importMode === "text" ? "active" : ""} onClick={() => setImportMode("text")}>文字</button>
              <button type="button" className={importMode === "screenshot" ? "active" : ""} onClick={() => setImportMode("screenshot")}>截图</button>
            </div>
            {importMode === "link" ? (
              <label className="importField">
                <span>歌单链接</span>
                <input
                  value={playlistUrl}
                  onChange={(event) => setPlaylistUrl(event.target.value)}
                  placeholder="粘贴网易云歌单链接，例如 https://music.163.com/#/playlist?id=..."
                />
              </label>
            ) : importMode === "text" ? (
              <label className="importField">
                <span>歌单文字</span>
                <textarea
                  value={playlistText}
                  onChange={(event) => setPlaylistText(event.target.value)}
                  placeholder={"每行一首，例如：\n遇见 - 孙燕姿\n十年 - 陈奕迅"}
                  rows={8}
                />
              </label>
            ) : (
              <label className="screenshotDrop">
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePlaylistImageChange} />
                <span>{playlistImageName || "上传歌单截图"}</span>
                <small>截图里需要同时看到歌名和歌手名</small>
              </label>
            )}
            <div className="modalActions">
              <button type="button" onClick={() => setIsImportPanelOpen(false)}>取消</button>
              <button type="button" className="primaryAction" onClick={importPlaylist} disabled={isImporting}>
                {isImporting ? "导入中" : "导入并重排"}
              </button>
            </div>
            <pre>{profileText}</pre>
          </div>
        </div>
      ) : null}

      {isLlmPanelOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="llm-config-title">
          <div className="playlistModal llmModal">
            <div className="modalHead">
              <div>
                <p className="label">Dialogue Engine</p>
                <h2 id="llm-config-title">连接 DeepSeek</h2>
              </div>
              <button type="button" className="iconButton" onClick={() => setIsLlmPanelOpen(false)} aria-label="关闭 DeepSeek 配置">
                ×
              </button>
            </div>
            <div className="llmCurrentState">
              <span>{llmStatus?.configured ? "已连接" : "未连接"}</span>
              <strong>{llmStatus?.configured ? `${llmStatus.provider} / ${llmStatus.model}` : "当前正在用本地规则兜底"}</strong>
            </div>
            <label className="importField">
              <span>DeepSeek API Key</span>
              <input
                value={llmApiKey}
                onChange={(event) => setLlmApiKey(event.target.value)}
                placeholder="sk-..."
                type="password"
                autoComplete="off"
              />
            </label>
            <label className="importField">
              <span>模型</span>
              <input value={llmModel} onChange={(event) => setLlmModel(event.target.value)} placeholder="deepseek-chat" />
            </label>
            <label className="importField">
              <span>API Base</span>
              <input value={llmApiBase} onChange={(event) => setLlmApiBase(event.target.value)} placeholder="https://api.deepseek.com" />
            </label>
            <div className="modalActions">
              <button type="button" onClick={() => setIsLlmPanelOpen(false)}>取消</button>
              <button type="button" className="primaryAction" onClick={saveLlmConfig} disabled={isSavingLlm}>
                {isSavingLlm ? "保存中" : "保存并启用"}
              </button>
            </div>
            <p className="configHint">Key 会写入本机 `.env.local`，不会进入 git。</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function formatClock(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function formatWeekday(value) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(value));
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function buildImportSummary(result, extractedCount) {
  const unmatchedCount = Math.max(0, (result.importedCount || extractedCount || 0) - (result.matchedCount || 0));
  const playableText = result.resolvedCount ? `，其中 ${result.resolvedCount} 首已经确认可播` : "";
  const unmatchedText = unmatchedCount ? `；还有 ${unmatchedCount} 首没匹配上，我会先用相近口味补队列` : "";
  return `我读到了 ${extractedCount} 首，图谱匹配到 ${result.matchedCount || 0} 首${playableText}${unmatchedText}。现在按你的歌单重排。`;
}

async function fetchJson(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error || response.statusText);
  return data;
}

createRoot(document.getElementById("root")).render(<App />);
