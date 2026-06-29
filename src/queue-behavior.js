export function mergeQueueAfterCurrent(currentQueue = [], incomingQueue = [], currentIndex = 0) {
  const safeCurrentIndex = Math.max(0, Number(currentIndex) || 0);
  const before = currentQueue.slice(0, Math.min(currentQueue.length, safeCurrentIndex + 1));
  const seen = new Set(before.map((track) => track?.id).filter(Boolean));
  const incoming = incomingQueue.filter((track) => {
    if (!track?.id || seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
  return [...before, ...incoming];
}

export function shouldQueueAfterCurrent(text, { hasActiveTrack = false, isPlaying = false } = {}) {
  void isPlaying;
  return resolveQueueRequestAction(text, { hasActiveTrack }) === "append";
}

export function resolveQueueRequestAction(text, { hasActiveTrack = false } = {}) {
  const clean = String(text || "");
  if (!hasActiveTrack) return "replace";
  if (/(换掉|换歌|切歌|重排|重新排|重新生成|现在播|现在播放|立刻播|马上播|直接播|马上换|立即切换|立即播放|马上切|现在切)/.test(clean)) return "replace";
  return "append";
}
