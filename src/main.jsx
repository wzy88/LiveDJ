import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const apiBase = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://127.0.0.1:8787" : "");
const samplePlaylist = [
  "遇见 - 孙燕姿",
  "十年 - 陈奕迅",
  "小幸运 - 田馥甄",
  "晴天 - 周杰伦",
  "红色高跟鞋 - 蔡健雅",
  "旅行的意义 - 陈绮贞",
  "无条件 - 陈奕迅",
  "浪费 - 林宥嘉"
].join("\n");

function App() {
  const [graphStats, setGraphStats] = useState(null);
  const [profile, setProfile] = useState(null);
  const [playlistText, setPlaylistText] = useState(samplePlaylist);
  const [query, setQuery] = useState("今晚下班路上，想听一点华语、松弛、但不要太丧");
  const [promptText, setPromptText] = useState("今晚下班路上，想听一点华语、松弛、但不要太丧");
  const [recommendations, setRecommendations] = useState([]);
  const [rawRecommendations, setRawRecommendations] = useState([]);
  const [anchors, setAnchors] = useState([]);
  const [activeTrack, setActiveTrack] = useState(null);
  const [resolvedTrack, setResolvedTrack] = useState(null);
  const [playableMap, setPlayableMap] = useState({});
  const [status, setStatus] = useState("正在读取歌曲图谱...");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [isPlaying, setIsPlaying] = useState(false);
  const [isNarrating, setIsNarrating] = useState(false);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
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
    const text = playlistText.trim();
    if (!text) {
      setStatus("先粘贴歌单内容，再导入。");
      return;
    }
    setIsImporting(true);
    setStatus("正在把你的歌单映射到歌曲图谱...");
    try {
      const result = await fetchJson("/api/profile/import", {
        method: "POST",
        body: JSON.stringify({ text })
      });
      setProfile(result);
      appendDialogueMessage("user", `导入了 ${result.importedCount} 首歌`);
      appendDialogueMessage("dj", `我读到了 ${result.importedCount} 首，匹配到 ${result.matchedCount} 首。现在按你的歌单重排。`);
      setStatus(`导入 ${result.importedCount} 首，图谱匹配 ${result.matchedCount} 首，可播解析 ${result.resolvedCount || 0} 首。`);
      await loadRecommendations("根据我刚导入的歌单，排一段最贴近我口味的电台", { appendDjResponse: true });
    } catch (error) {
      setStatus(`歌单导入失败：${error.message}`);
      appendDialogueMessage("dj", `歌单导入失败：${error.message}`);
    } finally {
      setIsImporting(false);
    }
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
      setRawRecommendations([]);
      setAnchors(result.anchors || []);
      setProfile(result.profile || profile);
      if (nextQueue[0]) {
        setActiveTrack(nextQueue[0]);
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
    setAnchors(result.anchors || []);
    setProfile((current) => result.profile || current);
    if (activeTrackRef.current) {
      const refreshedActive = nextQueue.find((track) => track.id === activeTrackRef.current.id);
      if (refreshedActive) setActiveTrack(refreshedActive);
    }
    prewarmScriptAudio(nextQueue);
    setStatus(`后台补齐完成：现在有 ${nextQueue.length} 首可播。`);
  }

  async function loadRawRecommendations() {
    setStatus("正在读取原始推荐...");
    const result = await fetchJson(`/api/recommendations?q=${encodeURIComponent(query)}&limit=18`);
    const next = result.recommendations || [];
    setRawRecommendations(next);
    setRecommendations(next);
    queueRef.current = next;
    setAnchors(result.anchors || []);
    setProfile(result.profile || profile);
    if (next[0]) {
      setActiveTrack(next[0]);
      setDjLine(next[0].script?.opening || "原始推荐已载入。");
    }
    setStatus(`原始推荐已加载：${next.length} 首。`);
    return result;
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

  async function verifyTopTracks() {
    const tracks = recommendations.slice(0, 8).map((track) => ({
      songId: track.id,
      title: track.title,
      artist: track.artist,
      providerIds: track.providerIds || [],
      durationSec: track.durationSec || null
    }));
    if (!tracks.length) return;
    setStatus("正在预热前 8 首可播缓存...");
    const result = await fetchJson("/api/playable/verify", {
      method: "POST",
      body: JSON.stringify({ tracks })
    });
    const nextPlayableMap = {};
    for (const item of result.results || []) {
      if (item.songId) nextPlayableMap[item.songId] = item.playable;
    }
    setPlayableMap((current) => ({ ...current, ...nextPlayableMap }));
    const okCount = (result.results || []).filter((item) => item.playable).length;
    setStatus(`可播预热完成：${okCount}/${tracks.length} 首通过。`);
    await loadRecommendations();
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
      if (audioRef.current && activeTrack.id === queueRef.current[currentIndex]?.id) {
        audioRef.current.muted = false;
        try {
          await audioRef.current.play();
          setIsPlaying(true);
        } catch {
          await playSelectedTrack(activeTrack);
        }
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

  const currentScriptLines = activeTrack?.script?.lines || [];

  return (
    <main className="appShell">
      <section className="stage">
        <div className="deviceFrame">
          <header className="deviceTop">
            <div>
              <p className="eyebrow">Claudio</p>
              <h1>今晚先听点像人的电台</h1>
            </div>
            <div className="statusPills">
              <span className="pill">LOGIN</span>
              <span className="pill pillActive">DARK</span>
              <span className="pill">LIVE</span>
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
                <span>score {activeTrack?.recommendScore ?? "-"}</span>
                <span>{resolvedTrack || activeTrack?.playable || playableMap[activeTrack?.id] ? "playable verified" : "not resolved yet"}</span>
                <span>{isNarrating ? "voice ducking" : isPlaying ? "playing" : "idle"}</span>
              </div>
            </div>
            <div className="transport">
              <button type="button" onClick={handlePrevious} aria-label="上一首">◀</button>
              <button type="button" className="transportMain" onClick={handleTransportPlay} aria-label={isPlaying ? "暂停" : "播放"}>
                {isPlaying ? "Ⅱ" : "▶"}
              </button>
              <button type="button" onClick={handleNext} aria-label="下一首">▶</button>
              <button type="button" onClick={verifyTopTracks} aria-label="预热">■</button>
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
                <button type="button" onClick={loadRawRecommendations}>原始</button>
                <button type="button" onClick={loadRecommendations}>推荐</button>
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
                    {track.playable || playableMap[track.id] ? "READY" : `${track.providerIds?.length || 0} ID`}
                  </span>
                </button>
              ))}
            </div>
            {rawRecommendations.length ? <p className="rawNotice">当前展示的是可播队列，原始推荐另有 {rawRecommendations.length} 首。</p> : null}
          </div>

          <audio ref={audioRef} onEnded={handleTrackEnded} hidden />
        </div>
      </section>

      <aside className="sidePanel">
        <div className="module">
          <div className="moduleHead">
            <h2>用户歌单</h2>
            <button type="button" onClick={importPlaylist} disabled={isImporting}>{isImporting ? "导入中" : "导入"}</button>
          </div>
          <textarea value={playlistText} onChange={(event) => setPlaylistText(event.target.value)} spellCheck="false" />
          <pre>{profileText}</pre>
        </div>

        <div className="module">
          <div className="moduleHead">
            <h2>推荐依据</h2>
            <button type="button" onClick={() => activeTrack && playSelectedTrack(activeTrack)}>播放当前</button>
          </div>
          {activeTrack ? (
            <>
              <div className="tagCloud">
                {activeTrack.scenes?.slice(0, 4).map((tag) => <span key={`s-${tag.value}`}>{tag.value}</span>)}
                {activeTrack.moods?.slice(0, 4).map((tag) => <span key={`m-${tag.value}`}>{tag.value}</span>)}
                {activeTrack.genres?.slice(0, 3).map((tag) => <span key={`g-${tag.value}`}>{tag.value}</span>)}
              </div>
              {currentScriptLines.length ? (
                <div className="scriptBox">
                  <h3>口播稿</h3>
                  {currentScriptLines.map((line, index) => (
                    <p key={`line-${index}`}>{line}</p>
                  ))}
                </div>
              ) : null}
              <ul className="evidenceList">
                {(activeTrack.evidence || []).map((item) => <li key={item}>{item}</li>)}
              </ul>
              <h3>相邻歌曲</h3>
              <div className="chipRow">
                {activeTrack.neighbors?.slice(0, 8).map((neighbor) => (
                  <span key={neighbor.id}>{neighbor.title} · {neighbor.artist}</span>
                ))}
              </div>
              <h3>来源歌单</h3>
              <div className="chipRow">
                {activeTrack.sources?.slice(0, 5).map((source) => (
                  <span key={`${source.playlistId}-${source.title}`}>{source.title}</span>
                ))}
              </div>
            </>
          ) : (
            <p>选择一首推荐歌查看证据。</p>
          )}
        </div>
      </aside>
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
