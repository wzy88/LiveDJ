import "./env.js";

export function isLlmConfigured() {
  const config = getLlmConfig();
  return Boolean(config.apiKey && config.model);
}

export function getLlmStatus() {
  const config = getLlmConfig();
  return {
    configured: isLlmConfigured(),
    provider: isLlmConfigured() ? config.provider : "rules",
    model: isLlmConfigured() ? config.model : "",
    apiBase: isLlmConfigured() ? config.apiBase.replace(/\/\/[^/@]+@/, "//***@") : "",
    missing: config.apiKey ? [] : ["DEEPSEEK_API_KEY"]
  };
}

export async function generateDialogueReplyWithLlm({ message, query, profile, activeTrack, queue } = {}) {
  const cleanMessage = cleanLine(message).slice(0, 240);
  if (!cleanMessage) return fallbackDialogueReply({ message: cleanMessage, activeTrack, queue });
  if (!isLlmConfigured()) return fallbackDialogueReply({ message: cleanMessage, activeTrack, queue });
  const config = getLlmConfig();

  const payload = {
    model: config.model,
    temperature: 0.72,
    response_format: { type: "json_object" },
    ...providerPayloadOptions(config),
    messages: [
      {
        role: "system",
        content: [
          "你是 Claudio，一个中文私人电台 DJ，像微信聊天里的朋友，不像客服或播音员。",
          "你要判断用户这句话的意图：music 表示要排歌/换方向；chat 表示闲聊/提问；mixed 表示先回答再顺手调台。",
          "回复要短，具体，有人味。不要重复“我正在看你的歌单画像和这次的状态”。",
          "如果是排歌、换歌、追加播放列表，回复必须点名已经给出的歌名或歌手，不要写抽象状态判断。",
          "禁用这些空泛词：情绪路线、气口、主线、慢慢听、很稳、接住、往下走、私人电台质感。",
          "如果用户问你的喜好，用 Claudio 的电台人格自然回答；不要说“我不用吃饭”“我没有身体”“我只是 AI”。",
          "不要解释你是 AI，不要写功能说明，不要写主持腔。",
          "只输出 JSON：{\"intent\":\"music|chat|mixed\",\"reply\":\"...\"}。"
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          message: cleanMessage,
          currentQuery: query || "",
          nowPlaying: activeTrack ? {
            title: activeTrack.title,
            artist: activeTrack.artist,
            moods: (activeTrack.moods || []).slice(0, 3),
            scenes: (activeTrack.scenes || []).slice(0, 3)
          } : null,
          queue: (queue || []).slice(0, 6).map((track) => ({
            title: track.title,
            artist: track.artist,
            moods: (track.moods || []).slice(0, 2),
            scenes: (track.scenes || []).slice(0, 2)
          })),
          profile: {
            importedCount: profile?.importedTracks?.length || profile?.importedCount || 0,
            topMoods: profile?.topMoods || [],
            topScenes: profile?.topScenes || [],
            topGenres: profile?.topGenres || [],
            sampleTracks: (profile?.importedTracks || []).slice(0, 8).map((track) => ({
              title: track.title,
              artist: track.artist
            }))
          }
        })
      }
    ]
  };

  try {
    const response = await fetch(`${config.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) return fallbackDialogueReply({ message: cleanMessage, activeTrack, queue });
    const data = await response.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    const intent = ["music", "chat", "mixed"].includes(parsed.intent) ? parsed.intent : inferDialogueIntent(cleanMessage);
    const reply = sanitizeDialogueReply(cleanLine(parsed.reply).slice(0, 180), { intent, queue });
    if (!reply) return fallbackDialogueReply({ message: cleanMessage, activeTrack, queue });
    return { intent, reply, source: "llm" };
  } catch {
    return fallbackDialogueReply({ message: cleanMessage, activeTrack, queue });
  }
}

export async function generateTalkScriptWithLlm({ track, context, fallbackScript, timeoutMs = 7000 }) {
  if (!isLlmConfigured()) return null;
  const config = getLlmConfig();
  const payload = {
    model: config.model,
    temperature: 0.82,
    response_format: { type: "json_object" },
    ...providerPayloadOptions(config),
    messages: [
      {
        role: "system",
        content: [
          "你是 Claudio，一个像朋友一样的中文私人电台 DJ。",
          "根据当前歌曲、用户输入、用户画像和推荐依据，写真实贴合当下的口播。",
          "如果有 showTalkPlan 和 contentPack，必须按节目级策划写：先服务这期节目，再服务单首歌。",
          "showTalkPlan 是整期节目大纲；contentPack 是当前歌曲的素材包，包括槽位、选择理由、故事和城市资讯。",
          "showTalkPlan.voiceProfile 是本期声音人格，优先级高于普通 DJ 口吻。默认是城市音乐编辑 + 朋友低声：具体、克制、有场景，不写主持腔。",
          "如果 voiceProfile 提供 bannedPhrases，输出不得包含这些词；如果提供 styleDirective，必须按它控制句子气质。",
          "不要写主持腔、广告腔、功能说明、操作说明。",
          "opening 必须从听众能理解的具体入口开始：歌名、歌手、当前时间/天气/地点场景，或有 songContext 时用“评论里/有人说/网络上”。",
          "opening 不要用“这里”“走到这儿”“这一首负责”“换一个速度”“把频道...”这类内部编排或抽象转场词开头。",
          "不要泛泛而谈，每首歌必须不同，必须引用歌曲、用户状态、推荐依据里的具体信息。",
          "禁用抽象电台腔：情绪路线、气口、主线、慢慢听、很稳、接住、往下走、负责把、私人时间。要换成具体歌名、歌手、场景、评论/故事或资讯点。",
          "只能使用输入 JSON 中明确给出的信息；不要编造歌词、歌单名、用户曾经反复听过、歌曲背后的故事。",
          "songContext 是已经抓取和清洗过的网易云评论/故事语境；hotCommentThemes/storySummary 用来概括，commentExcerpts 是允许短引用的评论原文摘录。",
          "如果 songContext.commentExcerpts 有内容，可以短引用其中一句，格式类似“评论里有一句：……”，但每段最多引用一句，不要连续复读评论。",
          "如果 songContext 为空，不要提热评、评论区、网友故事、歌曲背后故事。",
          "broadcastContext 只包含已提供的播出语境；可以自然使用 timeCue、weatherSummary、newsSummary、city、localSceneSummary、newsBriefs、cultureBriefs、editorialAngles。",
          "如果 weatherSummary 或 localSceneSummary 没有出现在输入里，不要主动补天气、温度、地铁口、环路、胡同口。",
          "queueIndex 大于 0 时，优先使用当前歌曲、评论、歌手或资讯角度，不要重复第一首已经讲过的天气和北京背景。",
          "newsBriefs/cultureBriefs/editorialAngles 是资讯和城市编辑素材，可以拼进歌曲场景与听众故事里，但不要说成突发、实时、独家新闻，不要编造未给出的事实。",
          "track.publicPlaylistReferences 只给你理解风格，不要在口播里说出这些公开歌单名，也不要把它说成“你导入的”。",
          "只有 track.evidence 里明确出现“来自你导入的歌单”，才可以说这首歌来自用户导入歌单。",
          "只有 nextTrack.evidence 里明确出现“来自你导入的歌单”，才可以说下一首来自用户导入歌单。",
          "可以说“推荐依据显示”“和你导入的歌单接近”，但不要说“我猜你某晚反复听过”。",
          "不要直接引用歌词原句；不要使用引号描述歌词、歌中某句、收尾那句或副歌那句。",
          "避免重复 recentLines 里出现过的表达、比喻和句式。",
          "每段要短一点，适合真的播出来：opening 45-75 字，bridge 每条 35-65 字，nextTease 35-75 字。",
          "如果有下一首歌，nextTease 要自然把当前歌尾巴接到下一首，不要像报幕。",
          "只输出 JSON：{\"opening\":\"...\",\"bridges\":[\"...\",\"...\"],\"nextTease\":\"...\",\"closing\":\"...\"}。"
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          userRequest: context.query || "",
          queueIndex: context.queueIndex || 0,
          track: {
            title: track.title,
            artist: track.artist,
            scenes: (track.scenes || []).slice(0, 4),
            moods: (track.moods || []).slice(0, 4),
            genres: (track.genres || []).slice(0, 3),
            evidence: (track.evidence || []).slice(0, 4),
            publicPlaylistReferences: (track.sources || []).slice(0, 3).map((item) => item.title)
          },
          nextTrack: context.nextTrack ? {
            title: context.nextTrack.title,
            artist: context.nextTrack.artist,
            scenes: (context.nextTrack.scenes || []).slice(0, 3),
            moods: (context.nextTrack.moods || []).slice(0, 3),
            genres: (context.nextTrack.genres || []).slice(0, 2),
            evidence: (context.nextTrack.evidence || []).slice(0, 4)
          } : null,
          songContext: normalizeSongContextForPrompt(context.songContext),
          broadcastContext: normalizeBroadcastContextForPrompt(context.broadcastContext, { queueIndex: context.queueIndex || 0 }),
          brief: normalizeBriefForPrompt(context.brief),
          showTalkPlan: normalizeShowTalkPlanForPrompt(context.showTalkPlan),
          contentPack: normalizeContentPackForPrompt(context.contentPack, { queueIndex: context.queueIndex || 0 }),
          recentLines: (context.recentLines || []).slice(-10),
          profile: {
            importedCount: context.profile?.importedTracks?.length || 0,
            importedTracks: (context.profile?.importedTracks || []).slice(0, 12).map((item) => ({
              title: item.title,
              artist: item.artist,
              matched: Boolean(item.match?.songId)
            }))
          },
          fallbackScript: {
            opening: fallbackScript?.opening || "",
            bridges: (fallbackScript?.bridges || []).slice(0, 2),
            nextTease: fallbackScript?.nextTease || ""
          }
        })
      }
    ]
  };

  try {
    const response = await fetch(`${config.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Math.max(500, timeoutMs))
    });
    if (!response.ok) {
      return makeRejectedScript(await buildLlmHttpErrorReason(response));
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content);
    const directImport = hasDirectImportEvidence(track);
    const nextDirectImport = hasDirectImportEvidence(context.nextTrack || {});
    const hasSongContext = hasUsableSongContext(context.songContext);
    const allowedCommentQuotes = getAllowedCommentQuotes(context.songContext);
    const sanitizerContext = { directImport, publicPlaylistNames: getPublicPlaylistNames(track), hasSongContext, allowedCommentQuotes };
    const nextSanitizerContext = { directImport: nextDirectImport, publicPlaylistNames: getPublicPlaylistNames(track), hasSongContext, allowedCommentQuotes };
    const opening = ensureTrackAnchor(
      sanitizeTalkClaim(cleanLine(parsed.opening), sanitizerContext),
      track
    ).slice(0, 150);
    const bridges = (Array.isArray(parsed.bridges) ? parsed.bridges : [])
      .map((line) => sanitizeTalkClaim(cleanLine(line), sanitizerContext).slice(0, 130))
      .filter(Boolean)
      .slice(0, 2);
    const nextTease = ensureNextTrackAnchor(
      sanitizeTalkClaim(cleanLine(parsed.nextTease), nextSanitizerContext),
      context.nextTrack
    ).slice(0, 150) || fallbackScript.nextTease || "";
    const closing = sanitizeTalkClaim(cleanLine(parsed.closing), sanitizerContext).slice(0, 120) || fallbackScript.closing || "";
    const recentLines = (context.recentLines || []).map((line) => cleanLine(line));
    if (!mentionsTrack(opening, track) && isTooSimilarToRecent(opening, recentLines)) return makeRejectedScript("opening_too_similar");
    if (!opening || bridges.length < 1) return makeRejectedScript(!opening ? "missing_opening" : "missing_bridge");
    let nextBridges = (bridges.length >= 2 ? bridges : [...bridges, fallbackScript.bridges?.[1]].filter(Boolean).slice(0, 2))
      .filter((line) => !isTooSimilarToRecent(line, recentLines));
    if (!nextBridges.length) {
      nextBridges = bridges.filter((line) => mentionsTrack(line, track)).slice(0, 1);
    }
    if (!nextBridges.length) return makeRejectedScript("bridges_too_similar");
    return {
      opening,
      bridges: nextBridges,
      nextTease,
      closing,
      lines: [opening, ...nextBridges, nextTease].filter(Boolean)
    };
  } catch (error) {
    return makeRejectedScript(`exception:${cleanLine(error?.message || "unknown").slice(0, 80)}`);
  }
}

function makeRejectedScript(reason) {
  return {
    rejected: true,
    reason
  };
}

async function buildLlmHttpErrorReason(response) {
  const status = response?.status || "unknown";
  const body = await response.text().catch(() => "");
  return `llm_http_${status}:${cleanLine(redactSecrets(body)).slice(0, 160)}`;
}

function redactSecrets(value = "") {
  return String(value)
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***");
}

function providerPayloadOptions(config = {}) {
  const model = cleanLine(config.model || "");
  const apiBase = cleanLine(config.apiBase || "");
  if (/deepseek/i.test(`${config.provider || ""} ${apiBase}`) && /^deepseek-v4-/i.test(model)) {
    return {
      thinking: { type: "disabled" }
    };
  }
  return {};
}

function normalizeBriefForPrompt(brief = {}) {
  const format = cleanLine(brief.format || "");
  const city = cleanLine(brief.city || "");
  const scene = cleanLine(brief.scene || "");
  const contentTaste = (brief.contentTaste || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 6);
  if (!format && !city && !scene && !contentTaste.length) return null;
  return compactObject({ format, city, scene, contentTaste });
}

function normalizeShowTalkPlanForPrompt(plan = {}) {
  const showThesis = cleanLine(plan.showThesis || "");
  const tone = cleanLine(plan.tone || "");
  const voiceProfile = normalizeVoiceProfileForPrompt(plan.voiceProfile);
  const recurringMotifs = (plan.recurringMotifs || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 5);
  const avoidPhrases = (plan.avoidPhrases || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 8);
  const tracks = (plan.tracks || []).map((item) => compactObject({
    title: cleanLine(item.title || ""),
    slot: cleanLine(item.slot || ""),
    talkAngle: cleanLine(item.talkAngle || ""),
    selectionReason: cleanLine(item.selectionReason || "")
  })).filter((item) => Object.keys(item).length).slice(0, 8);
  if (!showThesis && !tone && !voiceProfile && !recurringMotifs.length && !avoidPhrases.length && !tracks.length) return null;
  return compactObject({ showThesis, tone, voiceProfile, recurringMotifs, avoidPhrases, tracks });
}

function normalizeVoiceProfileForPrompt(profile = null) {
  if (!profile) return null;
  const id = cleanLine(profile.id || "");
  const label = cleanLine(profile.label || "");
  const styleDirective = cleanLine(profile.styleDirective || "");
  const talkDensity = cleanLine(profile.talkDensity || "");
  const materialPriority = (profile.materialPriority || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 8);
  const mustMention = (profile.mustMention || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 6);
  const mustUseWhenAvailable = (profile.mustUseWhenAvailable || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 6);
  const bannedPhrases = (profile.bannedPhrases || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 12);
  if (!id && !label && !styleDirective) return null;
  return compactObject({ id, label, styleDirective, talkDensity, materialPriority, mustMention, mustUseWhenAvailable, bannedPhrases });
}

function normalizeContentPackForPrompt(pack = {}, { queueIndex = 0 } = {}) {
  const programSlot = cleanLine(pack.programSlot || "");
  const programSlotLabel = cleanLine(pack.programSlotLabel || "");
  const selectionReason = cleanLine(pack.selectionReason || "");
  const transitionRole = cleanLine(pack.transitionRole || "");
  const story = compactObject({
    hotCommentThemes: (pack.story?.hotCommentThemes || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 3),
    commentExcerpts: normalizeCommentExcerptsForPrompt(pack.story?.commentExcerpts),
    storySummary: cleanLine(pack.story?.storySummary || ""),
    confidence: cleanLine(pack.story?.confidence || "")
  });
  const editorial = compactObject({
    city: cleanLine(pack.editorial?.city || ""),
    localSceneSummary: queueIndex <= 1 ? cleanLine(pack.editorial?.localSceneSummary || "") : "",
    newsBriefs: (pack.editorial?.newsBriefs || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 4),
    cultureBriefs: (pack.editorial?.cultureBriefs || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 4),
    editorialAngles: (pack.editorial?.editorialAngles || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 4)
  });
  const artist = compactObject({
    name: cleanLine(pack.artist?.name || ""),
    brief: cleanLine(pack.artist?.brief || ""),
    facts: (pack.artist?.facts || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 3)
  });
  const normalized = compactObject({
    programSlot,
    programSlotLabel,
    selectionReason,
    transitionRole,
    story,
    artist,
    editorial
  });
  return Object.keys(normalized).length ? normalized : null;
}

function normalizeSongContextForPrompt(songContext = {}) {
  const hotCommentThemes = (songContext.hotCommentThemes || [])
    .map((line) => cleanLine(line))
    .filter(Boolean)
    .slice(0, 3);
  const commentExcerpts = normalizeCommentExcerptsForPrompt(songContext.commentExcerpts);
  const storySummary = cleanLine(songContext.storySummary || "");
  if (!hotCommentThemes.length && !storySummary && !commentExcerpts.length) return null;
  return {
    provider: cleanLine(songContext.provider || ""),
    commentCount: Number(songContext.commentCount || 0) || 0,
    commentExcerpts,
    hotCommentThemes,
    storySummary
  };
}

function normalizeCommentExcerptsForPrompt(items = []) {
  return (items || [])
    .map((item) => compactObject({
      text: cleanLine(typeof item === "string" ? item : item?.text || "").slice(0, 90),
      theme: cleanLine(typeof item === "string" ? "" : item?.theme || ""),
      source: cleanLine(typeof item === "string" ? "netease-hot-comment" : item?.source || "netease-hot-comment")
    }))
    .filter((item) => item.text)
    .slice(0, 3);
}

function normalizeBroadcastContextForPrompt(broadcastContext = {}, { queueIndex = 0 } = {}) {
  const timeCue = cleanLine(broadcastContext.timeCue || "");
  const weatherSummary = queueIndex <= 0 ? cleanLine(broadcastContext.weatherSummary || "") : "";
  const newsSummary = cleanLine(broadcastContext.newsSummary || "");
  const city = cleanLine(broadcastContext.city || "");
  const localSceneSummary = queueIndex <= 1 ? cleanLine(broadcastContext.localSceneSummary || "") : "";
  const newsBriefs = normalizeBriefTexts(broadcastContext.newsBriefs);
  const cultureBriefs = normalizeBriefTexts(broadcastContext.cultureBriefs);
  const editorialAngles = (broadcastContext.editorialAngles || [])
    .map((line) => cleanLine(line))
    .filter(Boolean)
    .slice(0, 4);
  if (!timeCue && !weatherSummary && !newsSummary && !city && !localSceneSummary && !newsBriefs.length && !cultureBriefs.length && !editorialAngles.length) return null;
  return compactObject({
    timeCue,
    weatherSummary,
    newsSummary,
    city,
    localSceneSummary,
    newsBriefs,
    cultureBriefs,
    editorialAngles
  });
}

function normalizeBriefTexts(items = []) {
  return (items || [])
    .map((item) => cleanLine(typeof item === "string" ? item : item?.text || ""))
    .filter(Boolean)
    .slice(0, 4);
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (Array.isArray(item)) return item.length > 0;
      return Boolean(item);
    })
  );
}

function hasUsableSongContext(songContext = {}) {
  return Boolean(cleanLine(songContext?.storySummary || "") || songContext?.hotCommentThemes?.some((line) => cleanLine(line)));
}

function ensureTrackAnchor(line, track = {}) {
  const clean = cleanLine(line);
  if (!clean) return clean;
  if (mentionsTrack(clean, track)) return clean;
  const title = cleanLine(track.title || "");
  const artist = cleanLine(track.artist || "").split("/")[0].trim();
  if (title && artist) return `《${title}》这首由${artist}唱出来，${clean}`;
  if (title) return `《${title}》先放在这里，${clean}`;
  return clean;
}

function ensureNextTrackAnchor(line, nextTrack = null) {
  const clean = cleanLine(line);
  if (!clean || !nextTrack) return clean;
  if (mentionsTrack(clean, nextTrack)) return clean;
  const title = cleanLine(nextTrack.title || "");
  const artist = cleanLine(nextTrack.artist || "").split("/")[0].trim();
  if (title && artist) return `${clean}，待会儿接到《${title}》和${artist}的时候，节奏会自然往前走。`;
  if (title) return `${clean}，待会儿接到《${title}》的时候，节奏会自然往前走。`;
  return clean;
}

function mentionsTrack(line, track = {}) {
  const clean = cleanLine(line);
  const title = cleanLine(track?.title || "");
  const artist = cleanLine(track?.artist || "").split("/")[0].trim();
  return Boolean((title && clean.includes(title)) || (artist && clean.includes(artist)));
}

function hasDirectImportEvidence(track = {}) {
  return (track.evidence || []).some((item) => String(item).includes("来自你导入的歌单"));
}

function getPublicPlaylistNames(track = {}) {
  return (track.sources || [])
    .map((item) => cleanLine(item?.title || ""))
    .filter(Boolean);
}

function sanitizeTalkClaim(line, context = {}) {
  const { directImport = false, publicPlaylistNames = [], hasSongContext = false, allowedCommentQuotes = [] } = context;
  let clean = sanitizeTalkCopy(line);
  if (!directImport) {
    clean = clean
      .replace(/这首[^，。；]*从你导入的歌单里[^，。；]*[，。；]?/g, "推荐依据显示它和你的导入歌单很接近，")
      .replace(/也来自你导入的歌单/g, "也和你的导入歌单接近")
      .replace(/来自你导入的歌单/g, "和你的导入歌单接近")
      .replace(/也来自你的歌单/g, "也和你的歌单接近")
      .replace(/来自你的歌单/g, "和你的歌单接近")
      .replace(/也在你导入的歌单里/g, "也和你的导入歌单接近")
      .replace(/也在你歌单里/g, "也和你的歌单接近")
      .replace(/从你导入的歌单里翻出来的?/g, "和你的导入歌单很接近")
      .replace(/你歌单里本来就有/g, "推荐依据里它很贴近你的歌单")
      .replace(/你导入的歌单里本来就有/g, "推荐依据里它很贴近你的歌单")
      .replace(/你导入的歌单里[^，。；]*这首/g, "推荐依据里这首")
      .replace(/你导入的歌单里那些/g, "你歌单附近那些")
      .replace(/你导入的歌单里/g, "你歌单附近")
      .replace(/你收藏了不少/g, "这些参考歌单里有不少")
      .replace(/你常听的那些歌/g, "你导入歌单附近的歌");
  }
  if (!hasSongContext) {
    clean = clean
      .replace(/(?:热评|评论区|网友|听众故事|歌曲背后故事)[^，。；]*[，。；]?/g, "")
      .replace(/很多人(?:在评论里|把它听成)[^，。；]*[，。；]?/g, "");
  }
  clean = sanitizeCommentQuoteClaims(clean, allowedCommentQuotes);
  clean = removeLyricQuoteClaims(clean);
  clean = removePublicPlaylistNames(clean, publicPlaylistNames);
  return clean
    .replace(/我猜[^，。；]*(反复听过|某个晚上)[，。；]?/g, "")
    .replace(/你反复听过/g, "你可能会熟悉")
    .replace(/\s+/g, " ")
    .trim();
}

function getAllowedCommentQuotes(songContext = {}) {
  return (songContext?.commentExcerpts || [])
    .map((item) => cleanLine(typeof item === "string" ? item : item?.text || ""))
    .filter(Boolean)
    .slice(0, 6);
}

function sanitizeCommentQuoteClaims(line = "", allowedQuotes = []) {
  const allowed = allowedQuotes.map((quote) => normalizeQuoteText(quote)).filter(Boolean);
  return cleanLine(line)
    .replace(/(?:它下面|这首歌下面|下面)(?:有人写|有人说)[:：]\s*([^。；\n]{1,90})([。；]?)/g, (_match, quote, ending = "") => {
      const displayQuote = cleanCommentQuoteDisplay(quote);
      const normalizedQuote = normalizeQuoteText(displayQuote);
      if (!normalizedQuote) return "";
      const isAllowed = allowed.some((item) => normalizedQuote.includes(item) || item.includes(normalizedQuote) || quoteSimilarity(normalizedQuote, item) >= 0.72);
      return isAllowed ? `评论里有一句：${displayQuote}${ending || "。"}` : "";
    })
    .replace(/评论里(?:有一句|有人说|写着)[:：，,]\s*([^。；\n]{1,90})([。；]?)/g, (match, quote, ending = "") => {
    const displayQuote = cleanCommentQuoteDisplay(quote);
    const normalizedQuote = normalizeQuoteText(displayQuote);
    if (!normalizedQuote) return "";
    const isAllowed = allowed.some((item) => normalizedQuote.includes(item) || item.includes(normalizedQuote) || quoteSimilarity(normalizedQuote, item) >= 0.72);
    if (isAllowed) return `评论里有一句：${displayQuote}${ending || "。"}`;
    return `放回北京今晚的背景里，${displayQuote}${ending || "。"}`;
    });
}

function cleanCommentQuoteDisplay(value = "") {
  return cleanLine(value)
    .replace(/^[“”"'‘’\s]+|[“”"'‘’\s]+$/g, "")
    .trim();
}

function normalizeQuoteText(value = "") {
  return cleanLine(value)
    .replace(/是/g, "")
    .replace(/[“”"'‘’《》，。！？、：:；;\s]/g, "")
    .slice(0, 90);
}

function quoteSimilarity(left = "", right = "") {
  const leftTokens = new Set(left.match(/[\u4e00-\u9fff]{2}/g) || []);
  const rightTokens = new Set(right.match(/[\u4e00-\u9fff]{2}/g) || []);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.min(leftTokens.size, rightTokens.size);
}

function sanitizeTalkCopy(value = "") {
  return cleanLine(value)
    .replace(/把频道稍微拨暗一点/g, "这里换一个更稳的速度")
    .replace(/先把频道调稳/g, "先把节奏调稳")
    .replace(/这一首负责把气口接住/g, "这一首先把节奏稳住")
    .replace(/气口/g, "节奏")
    .replace(/情绪路线/g, "这组歌")
    .replace(/情绪换了一口气/g, "下一首换到新的歌手和素材")
    .replace(/情绪换一口气/g, "下一首换到新的歌手和素材")
    .replace(/换一种情绪/g, "换到下一首的歌手和素材")
    .replace(/不急着往前走/g, "先把当前这首听完整")
    .replace(/还挂在北京的夜晚里/g, "继续放在北京夜里的节目里")
    .replace(/他说，评论里那一句，?/g, "")
    .replace(/这比单纯的介绍更像一个真实入口/g, "这句评论可以把歌里的关系说得更具体")
    .replace(/这比单纯介绍《([^》]+)》更像一个真实入口/g, "这句评论可以把《$1》说得更具体")
    .replace(/主线/g, "线索")
    .replace(/慢慢听/g, "先听这首")
    .replace(/很稳/g, "比较顺")
    .replace(/接住/g, "接上")
    .replace(/往下走/g, "继续排")
    .replace(/继续往前/g, "继续排")
    .replace(/继续往下走/g, "接到下一首")
    .replace(/继续往回走/g, "把下一首接到具体的歌名和场景上")
    .replace(/风突然换了方向/g, "下一首会换到另一组歌手和场景")
    .replace(/风换了方向/g, "下一首会换到另一组歌手和场景")
    .replace(/风里多了一点胡同的味道/g, "下一首会把歌手和故事换一个角度")
    .replace(/不急着安慰人，只把声音放到一个舒服的位置/g, "不急着讲道理，只把音量放轻一点")
    .replace(/不负责劝人，只负责别太用力地陪着/g, "不急着讲道理，也不把情绪推得太满")
    .replace(/先把音量放轻，让这几分钟像一盏不刺眼的灯/g, "先把音量放轻，让这几分钟留给自己")
    .replace(/像一盏不刺眼的灯/g, "像一段不打扰人的路")
    .replace(/换一束侧光进来/g, "换一个角度听")
    .replace(/把声音放到一个舒服的位置/g, "把音量放轻一点")
    .replace(/负责把/g, "先把");
}

function removeLyricQuoteClaims(line) {
  return cleanLine(line)
    .replace(/(?:收尾|开头|副歌|歌里|歌词里|歌中|这一段|那一段|最后|歌尾巴)?[^，。；]*?那句[“"'][^”"']+[”"'][^，。；]*[，。；]?/g, "这段表达不用说破，")
    .replace(/歌词里[^，。；]*?[“"'][^”"']+[”"'][^，。；]*[，。；]?/g, "这里少引用歌词，只保留那点情绪，")
    .replace(/(?:唱到|写到|反复唱)[^，。；]*?[“"'][^”"']+[”"'][^，。；]*[，。；]?/g, "歌里的情绪不用被复述，")
    .replace(/[“"'][^”"']{1,40}[”"']/g, "")
    .replace(/，{2,}/g, "，")
    .replace(/^，|，$/g, "")
    .trim();
}

function removePublicPlaylistNames(line, names = []) {
  let clean = cleanLine(line);
  for (const name of names) {
    clean = clean.replace(new RegExp(escapeRegExp(`「${name}」`), "g"), "这些公开参考");
    clean = clean.replace(new RegExp(escapeRegExp(`《${name}》`), "g"), "这些公开参考");
    clean = clean.replace(new RegExp(escapeRegExp(name), "g"), "这些公开参考");
  }
  return clean
    .replace(/从(?:这些公开参考)(?:和(?:这些公开参考))*[^，。；]*(?:来源|歌单)[^，。；]*[，。；]?/g, "参考歌单只帮我校准一点气质，")
    .replace(/这些公开参考和这些公开参考/g, "这些公开参考")
    .replace(/这些公开参考两个来源/g, "这些公开参考")
    .trim();
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTooSimilarToRecent(line, recentLines = []) {
  const key = normalizeForSimilarity(line);
  if (!key || key.length < 12) return false;
  const linePhrases = signaturePhrases(line);
  return recentLines.some((recent) => {
    if (mentionsDifferentExplicitTracks(line, recent)) return false;
    const recentKey = normalizeForSimilarity(recent);
    if (!recentKey) return false;
    const sharedPhrase = linePhrases.some((phrase) => signaturePhrases(recent).includes(phrase));
    return sharedPhrase || key.includes(recentKey.slice(0, 14)) || recentKey.includes(key.slice(0, 14)) || overlapScore(key, recentKey) > 0.62;
  });
}

function mentionsDifferentExplicitTracks(left = "", right = "") {
  const leftTitles = explicitTrackTitles(left);
  const rightTitles = explicitTrackTitles(right);
  if (!leftTitles.length || !rightTitles.length) return false;
  return leftTitles.every((title) => !rightTitles.includes(title)) && rightTitles.every((title) => !leftTitles.includes(title));
}

function explicitTrackTitles(value = "") {
  return [...cleanLine(value).matchAll(/《([^》]{1,32})》/g)]
    .map((match) => cleanLine(match[1]))
    .filter(Boolean);
}

function normalizeForSimilarity(value = "") {
  return cleanLine(value)
    .replace(/[《》“”"'，。！？、,.!?]/g, "")
    .replace(/\s+/g, "")
    .slice(0, 80);
}

function overlapScore(left, right) {
  const leftTokens = new Set(left.match(/[\u4e00-\u9fff]{2}|[a-z0-9]{3,}/gi) || []);
  const rightTokens = new Set(right.match(/[\u4e00-\u9fff]{2}|[a-z0-9]{3,}/gi) || []);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function signaturePhrases(value = "") {
  const clean = cleanLine(value);
  const phrases = [
    "身体先松下来",
    "肩膀先松下来",
    "白天拧着",
    "温柔的拉扯",
    "不急着解决",
    "不急着给答案",
    "不把话说满",
    "把解释放少一点"
  ];
  return phrases.filter((phrase) => clean.includes(phrase));
}

export async function extractTracksFromPlaylistScreenshot(imageDataUrl) {
  if (!isLlmConfigured()) {
    throw new Error("截图导入需要先配置 LLM_API_KEY 和 LLM_MODEL。");
  }
  const config = getLlmConfig();
  const cleanImage = String(imageDataUrl || "").trim();
  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(cleanImage)) {
    throw new Error("请上传 PNG、JPG 或 WebP 歌单截图。");
  }
  const response = await fetch(`${config.apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: process.env.LLM_VISION_MODEL || process.env.DEEPSEEK_VISION_MODEL || config.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "你是歌单截图 OCR。只提取截图中可见歌曲，输出 JSON：{\"tracks\":[{\"title\":\"歌名\",\"artist\":\"歌手\"}]}。不要补全截图里没有的歌。"
        },
        {
          role: "user",
          content: [
            { type: "text", text: "从这张歌单截图里提取歌曲名和歌手名。" },
            { type: "image_url", image_url: { url: cleanImage } }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    throw new Error(`截图解析失败：${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const parsed = JSON.parse(content);
  const tracks = (Array.isArray(parsed.tracks) ? parsed.tracks : [])
    .map((track) => ({
      title: cleanLine(track.title),
      artist: cleanLine(track.artist)
    }))
    .filter((track) => track.title && track.artist)
    .slice(0, 80);
  if (!tracks.length) {
    throw new Error("没有从截图里识别到歌曲。请换一张更清晰、包含歌名和歌手的截图。");
  }
  return tracks;
}

function cleanLine(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim();
}

function sanitizeDialogueReply(reply = "", { intent = "chat", queue = [] } = {}) {
  const clean = cleanLine(reply);
  if (!clean) return "";
  const isMusicIntent = intent === "music" || intent === "mixed";
  const hasQueue = Array.isArray(queue) && queue.length > 0;
  if (isMusicIntent && hasQueue) {
    return buildConcreteQueueReply(queue);
  }
  if (hasAbstractRadioCopy(clean)) {
    return isMusicIntent && hasQueue ? buildConcreteQueueReply(queue) : "";
  }
  return clean;
}

function hasAbstractRadioCopy(value = "") {
  return /情绪路线|慢慢听|很稳|气口|主线|接住|往下走|继续往前|私人电台质感|可播音源|筛一遍/.test(value);
}

function mentionsAnyQueueTrack(reply = "", queue = []) {
  const clean = cleanLine(reply);
  return (queue || []).some((track) => {
    const title = cleanLine(track?.title || "");
    const artist = cleanLine(track?.artist || "").split("/")[0].trim();
    return Boolean((title && clean.includes(title)) || (artist && clean.includes(artist)));
  });
}

function buildConcreteQueueReply(queue = []) {
  const tracks = (queue || []).filter((track) => cleanLine(track?.title || "")).slice(0, 4);
  const first = tracks[0];
  if (!first) return "我试着重新排了一轮，但这次没有找到稳定可播的歌。你换个歌手、曲风或场景，我再排。";
  const firstLabel = formatTrackLabel(first);
  const rest = tracks.slice(1).map((track) => `《${cleanLine(track.title)}》`).join("、");
  return rest
    ? `排好了。先播${firstLabel}，后面接 ${rest}。`
    : `排好了。先播${firstLabel}。`;
}

function formatTrackLabel(track = {}) {
  const title = cleanLine(track.title || "这首歌");
  const artist = cleanLine(track.artist || "").split("/")[0].trim();
  return artist ? `《${title}》-${artist}` : `《${title}》`;
}

function fallbackDialogueReply({ message, activeTrack, queue } = {}) {
  const intent = inferDialogueIntent(message);
  if (intent === "chat") {
    if (/你平常|你通常|你会做|你能做|你是干嘛|介绍/.test(message)) {
      return {
        intent,
        source: "rules",
        reply: "我主要做三件事：听懂你现在的状态，按你的歌单口味接歌，再在歌和歌之间说几句不打扰的串联。你可以把我当成一个会慢慢记住你的私人电台。"
      };
    }
    return {
      intent,
      source: "rules",
      reply: activeTrack
        ? `我在听你这句，也看着现在这首《${activeTrack.title}》。你可以直接说想换轻一点、少说话一点，或者问我为什么接这首。`
        : "我在。你可以跟我说一个状态、一段路、一个人，或者直接问我为什么这样接歌。"
    };
  }
  if (Array.isArray(queue) && queue.length) {
    return {
      intent,
      source: "rules",
      reply: buildConcreteQueueReply(queue)
    };
  }
  return {
    intent,
    source: "rules",
    reply: activeTrack
      ? `好，我会按你的新要求接到《${activeTrack.title}》后面，排好后直接告诉你下一首。`
      : "好，我按你的要求重新排歌，排好后直接告诉你先播哪首。"
  };
}

function inferDialogueIntent(message = "") {
  if (!message) return "chat";
  if (/(想听|放|播|来点|来一首|换歌|歌单|华语|粤语|摇滚|民谣|R&B|说唱|爵士|电子|下班|通勤|睡觉|失眠|emo|开心|提神|安静|松弛|不要太丧)/i.test(message)) {
    return "music";
  }
  return "chat";
}

function getLlmConfig() {
  const apiKey =
    process.env.LLM_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.DEEPSEEK_KEY ||
    process.env.DEEPSEEK_TOKEN ||
    process.env.OPENAI_API_KEY ||
    "";
  const hasDeepSeekKey = Boolean(process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY || process.env.DEEPSEEK_TOKEN);
  const apiBase = (
    process.env.LLM_API_BASE ||
    process.env.DEEPSEEK_API_BASE ||
    (hasDeepSeekKey ? "https://api.deepseek.com" : "https://api.openai.com/v1")
  ).replace(/\/+$/, "");
  const model =
    process.env.LLM_MODEL ||
    process.env.DEEPSEEK_MODEL ||
    (hasDeepSeekKey ? "deepseek-chat" : "");
  const provider =
    process.env.LLM_PROVIDER ||
    (hasDeepSeekKey || /deepseek/i.test(apiBase) ? "deepseek" : "openai-compatible");
  return {
    apiKey,
    apiBase,
    model,
    provider
  };
}
