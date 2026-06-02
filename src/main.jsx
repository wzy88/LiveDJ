import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const apiBase = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://127.0.0.1:8787" : "");

function App() {
  const [graphStats, setGraphStats] = useState(null);
  const [profile, setProfile] = useState(null);
  const [importMode, setImportMode] = useState("link");
  const [playlistUrl, setPlaylistUrl] = useState("");
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
  const [musicVolume, setMusicVolume] = useState(0.88);
  const [djLine, setDjLine] = useState("把你的想法丢给我，我来接歌。");
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
      audioRef.current.volume = isNarrating ? Math.min(musicVolume, 0.24) : musicVolume;
    }
  }, [isNarrating, musicVolume]);

  useEffect(() => {
    return () => stopSpeechAndTimers();
  }, []);

  async function refreshAll() {
    const [stats, profileResult] = await Promise.all([
      fetchJson("/api/graph/stats").catch((error) => ({ error: error.message })),
      fetchJson("/api/profile").catch(() => null)
    ]);
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
        : await importPlaylistLink();
      const extractedCount = result.source?.extractedCount || result.importedCount || 0;
      setProfile(result);
      appendDialogueMessage("user", importMode === "screenshot" ? `上传了一张歌单截图` : `导入了一个歌单链接`);
      appendDialogueMessage("dj", `我读到了 ${extractedCount} 首，图谱匹配到 ${result.matchedCount} 首。现在按你的歌单重排。`);
      setStatus(`导入 ${extractedCount} 首，图谱匹配 ${result.matchedCount} 首，可播解析 ${result.resolvedCount || 0} 首。`);
      await loadRecommendations("根据我刚导入的歌单，排一段最贴近我口味的电台", { appendDjResponse: true });
      setIsImportPanelOpen(false);
    } catch (error) {
      setStatus(`歌单导入失败：${error.message}`);
      appendDialogueMessage("dj", `歌单导入失败：${error.message}`);
    } finally {
      setIsImporting(false);
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
    primeAudioElement();
    const index = queueRef.current.findIndex((item) => item.id === track.id);
    if (track.resolvedTrack && index >= 0) {
      await playTrackAtIndex(index, queueRef.current);
      return;
    }
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
        await waitForAudioReady(audioRef.current);
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (error) {
        setStatus(`播放失败：${error.message}。请再点一次播放，或换一首 READY 歌曲。`);
      }
    }
    await sendFeedback(track.id, "played", false);
  }

  async function startRadio() {
    primeAudioElement();
    if (recommendations?.[0]) {
      await playTrackAtIndex(0, recommendations);
      return;
    }
    const program = await loadRecommendations();
    if (program?.queue?.[0]) {
      await playTrackAtIndex(0, program.queue);
    }
  }

  async function playTrackAtIndex(index, queue = queueRef.current) {
    const safeIndex = index < 0 ? 0 : index;
    const track = queue[safeIndex];
    if (!track?.resolvedTrack) {
      setStatus("这首还没有准备好可播音源。");
      return;
    }
    primeAudioElement();
    stopSpeechAndTimers();
    setCurrentIndex(safeIndex);
    setActiveTrack(track);
    setResolvedTrack(track.resolvedTrack);
    setDjLine(track.script?.opening || `正在播放《${track.title}》。`);
    setStatus(`正在播放：${track.title} - ${track.artist}`);
    if (audioRef.current) {
      audioRef.current.src = toAudioSource(track.resolvedTrack.streamUrl);
      audioRef.current.load();
      audioRef.current.loop = false;
      audioRef.current.muted = false;
      audioRef.current.volume = musicVolume;
      try {
        await waitForAudioReady(audioRef.current);
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (error) {
        setStatus(`播放失败：${error.message}。请再点一次播放，或换一首 READY 歌曲。`);
        setIsPlaying(false);
        return;
      }
    }
    scheduleTalkover(track);
    await sendFeedback(track.id, "played", false);
  }

  async function handleTrackEnded() {
    stopSpeechAndTimers();
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

  function scheduleTalkover(track) {
    const script = track.script;
    if (!script) return;
    const durationMs = Math.max(120000, Math.round((track.resolvedTrack?.durationSec || track.durationSec || 220) * 1000));
    const points = [
      1500,
      Math.min(Math.max(25000, durationMs * 0.3), durationMs - 65000),
      Math.min(Math.max(65000, durationMs * 0.64), durationMs - 12000)
    ].filter((value, index, arr) => Number.isFinite(value) && value > 0 && arr.indexOf(value) === index);
    const lines = [script.opening, ...(script.bridges || [])].filter(Boolean).slice(0, points.length);
    lines.forEach((line, index) => {
      talkTimersRef.current.push(
        window.setTimeout(() => speakOverMusic(line), Math.max(0, points[index]))
      );
    });
  }

  async function speakOverMusic(text) {
    if (typeof window === "undefined" || !text) return;
    const token = ++speechSeqRef.current;
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
        setStatus("口播中...");
      };
      voiceAudio.onended = () => {
        if (token !== speechSeqRef.current) return;
        setIsNarrating(false);
        setStatus("电台继续播放中。");
        if (voiceUrlRef.current) {
          URL.revokeObjectURL(voiceUrlRef.current);
          voiceUrlRef.current = "";
        }
      };
      voiceAudio.onerror = () => {
        if (token !== speechSeqRef.current) return;
        setIsNarrating(false);
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
      setStatus(`口播失败：${error.message}`);
    }
  }

  function playFallbackSpeech(text, token) {
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
      setStatus("口播中...");
    };
    utterance.onend = () => {
      if (token !== speechSeqRef.current) return;
      setIsNarrating(false);
      setStatus("电台继续播放中。");
    };
    utterance.onerror = () => {
      if (token !== speechSeqRef.current) return;
      setIsNarrating(false);
      setStatus("口播播放失败，已回到音乐。");
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function prewarmScriptAudio(queue) {
    const lines = queue
      .slice(0, 2)
      .map((track) => track.script?.opening)
      .filter(Boolean);
    for (const line of lines) {
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

  function waitForAudioReady(audio) {
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        audio.removeEventListener("canplay", onReady);
        audio.removeEventListener("loadedmetadata", onReady);
        audio.removeEventListener("canplaythrough", onReady);
        clearTimeout(timer);
      };
      const onReady = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      }, 7000);
      audio.addEventListener("canplay", onReady, { once: true });
      audio.addEventListener("loadedmetadata", onReady, { once: true });
      audio.addEventListener("canplaythrough", onReady, { once: true });
    });
  }

  async function sendFeedback(songId, signal, reload = true) {
    const result = await fetchJson("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ songId, signal })
    });
    setProfile(result);
    if (reload) await loadRecommendations();
  }

  async function handlePromptSubmit(event) {
    event.preventDefault();
    const nextQuery = promptText.trim();
    if (!nextQuery) return;
    stopSpeechAndTimers();
    programPromiseRef.current = null;
    deepProgramPromiseRef.current = null;
    setQuery(nextQuery);
    latestQueryRef.current = nextQuery;
    appendDialogueMessage("user", nextQuery);
    appendDialogueMessage("dj", "我正在看你的歌单画像和这次的状态，马上接一段能播的。");
    setDjLine("我正在看你的歌单画像和这次的状态，马上接一段能播的。");
    setPromptText("");
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
    return [
      `导入 ${profile.importedCount || 0} 首 / 匹配 ${profile.matchedCount || 0} 首`,
      profile.resolvedCount ? `已解析可播 ${profile.resolvedCount} 首` : "",
      profile.topScenes?.length ? `场景 ${profile.topScenes.map((x) => x.value).join("、")}` : "",
      profile.topMoods?.length ? `情绪 ${profile.topMoods.map((x) => x.value).join("、")}` : "",
      profile.topGenres?.length ? `曲风 ${profile.topGenres.map((x) => x.value).join("、")}` : ""
    ].filter(Boolean).join("\n");
  }, [profile]);

  const tasteSummary = profile?.importedCount
    ? `已导入 ${profile.importedCount} 首，匹配 ${profile.matchedCount || 0} 首`
    : "导入歌单后，电台会优先按你的口味接歌";

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
              <button type="button" className="transportMain" onClick={handleTransportPlay} aria-label={isPlaying ? "暂停" : "播放"}>
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

          <div className="handwrittenBlock">
            <span className="handwritten">what's next on your mind</span>
            <span className="handwrittenCn">你接下来在想什么</span>
          </div>

          <div className="dialoguePanel">
            <div className="djRow">
              <div className="djAvatar">C</div>
              <div className="dialogueStack">
                {dialogueMessages.map((message) => (
                  <div className={message.role === "user" ? "bubble userBubble" : "bubble"} key={message.id}>
                    <p className="bubbleName">{message.role === "user" ? "You" : "Claudio"}</p>
                    <p>{message.text}</p>
                  </div>
                ))}
              </div>
            </div>

            <form className="promptRow" onSubmit={handlePromptSubmit}>
              <input value={promptText} onChange={(event) => setPromptText(event.target.value)} placeholder={query || "Say something to the DJ..."} />
              <button type="submit" aria-label="生成队列">→</button>
            </form>

            <div className="footerBar">
              <span>CLAUDIO FM</span>
              <span>{isNarrating ? "TALKING" : isLoadingQueue ? "TUNING" : "CONNECTED"}</span>
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
                    {track.playable ? "READY" : "准备中"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <audio ref={audioRef} onEnded={handleTrackEnded} hidden />
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
