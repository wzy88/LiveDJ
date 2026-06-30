export function buildProgramReadyReply(programOrQueue, { mode = "replace", query = "" } = {}) {
  const program = Array.isArray(programOrQueue) ? { queue: programOrQueue } : (programOrQueue || {});
  const queue = Array.isArray(program.visibleQueue) ? program.visibleQueue : (Array.isArray(program.queue) ? program.queue : []);
  const first = queue[0];
  if (!first) {
    const rejectedSummary = summarizeRejected(program.rejected, query);
    return rejectedSummary
      ? `${rejectedSummary} 这次没有找到稳定可播的替代歌曲，你换个歌手、曲风或场景，我再排。`
      : "我试着换了一轮，但这次没有找到稳定可播的歌。换个歌手、曲风或场景，我再排。";
  }

  const queueLine = mode === "append"
    ? buildAppendQueueLine(queue)
    : buildReplaceQueueLine(queue);
  const modeLine = mode === "append" ? "当前这首我不打断，新的队列会从下一首开始。" : "我已经换成这组新的播放队列。";
  const rejectedSummary = summarizeRejected(program.rejected, query);
  const editorialLine = buildEditorialReason(program, query);
  return [modeLine, rejectedSummary, queueLine, editorialLine].filter(Boolean).join(" ");
}

function buildAppendQueueLine(queue = []) {
  const current = queue[0];
  const next = queue[1];
  const rest = queue.slice(2, 5).map((track) => `《${cleanText(track?.title)}》`).filter(Boolean).join("、");
  if (!next) return `当前正在播${formatTrackLabel(current)}，后面暂时没有稳定可播的新歌。`;
  return rest
    ? `当前正在播${formatTrackLabel(current)}，下一首接${formatTrackLabel(next)}，后面还有 ${rest}。`
    : `当前正在播${formatTrackLabel(current)}，下一首接${formatTrackLabel(next)}。`;
}

function buildReplaceQueueLine(queue = []) {
  const first = queue[0];
  const rest = queue.slice(1, 4).map((track) => `《${cleanText(track?.title)}》`).filter(Boolean).join("、");
  return rest
    ? `实际接上的是${formatTrackLabel(first)}，后面还有 ${rest}。`
    : `实际接上的是${formatTrackLabel(first)}。`;
}

export function summarizeRejected(rejected = [], query = "") {
  const wanted = extractWantedTerms(query);
  const rows = Array.isArray(rejected) ? rejected : [];
  const relevant = rows.filter((item) => {
    const text = `${item?.title || ""} ${item?.artist || ""}`.toLowerCase();
    return wanted.some((term) => text.includes(term.toLowerCase()));
  });
  const source = relevant.length ? relevant : rows.slice(0, 2);
  if (!source.length) return "";
  const names = unique(
    source
      .map((item) => cleanText(item?.artist || item?.title || ""))
      .filter(Boolean)
  ).slice(0, 2);
  const reason = source.find((item) => item?.reason)?.reason || "没有通过可播验证";
  if (!names.length) return `你点名的歌这轮没有接上，主要是${reason}。`;
  return `${names.join("、")}这轮没有接上，主要是${reason}。`;
}

function buildEditorialReason(program = {}, query = "") {
  const brief = program.brief || {};
  const parts = [];
  if (brief.city) parts.push(brief.city);
  if (brief.scene) parts.push(brief.scene);
  if (Array.isArray(brief.contentTaste) && brief.contentTaste.length) {
    const labels = brief.contentTaste
      .map((item) => ({
        "hot-comments": "热评",
        news: "资讯",
        gossip: "八卦"
      })[item] || item)
      .slice(0, 2);
    parts.push(labels.join("和"));
  }
  const wanted = extractWantedTerms(query).slice(0, 2);
  if (!parts.length && !wanted.length) return "";
  const topic = wanted.length ? wanted.join("、") : parts.join("、");
  const frame = parts.length ? `按${parts.join("、")}来写口播` : "按你的这句需求来写口播";
  return `我会把${topic}这条线放进口播里，${frame}。`;
}

function formatTrackLabel(track = {}) {
  const title = cleanText(track.title || "这首歌");
  const artist = cleanText(track.artist || "").split("/")[0].trim();
  return artist ? `《${title}》-${artist}` : `《${title}》`;
}

function extractWantedTerms(query = "") {
  const text = cleanText(query);
  const terms = [];
  const known = [
    "凤凰传奇",
    "李宗盛",
    "周杰伦",
    "陈奕迅",
    "梁静茹",
    "孙燕姿",
    "王菲",
    "民谣",
    "粤语",
    "摇滚",
    "说唱",
    "开车",
    "北京",
    "犯困",
    "热评",
    "八卦",
    "新闻",
    "天气",
    "创作背景"
  ];
  known.forEach((term) => {
    if (text.includes(term)) terms.push(term);
  });
  return unique(terms);
}

function unique(values = []) {
  return [...new Set(values)];
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").replace(/[<>]/g, "").trim();
}
