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
  if (!cleanMessage) return fallbackDialogueReply({ message: cleanMessage, activeTrack });
  if (!isLlmConfigured()) return fallbackDialogueReply({ message: cleanMessage, activeTrack });
  const config = getLlmConfig();

  const payload = {
    model: config.model,
    temperature: 0.72,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "你是 Claudio，一个中文私人电台 DJ，像微信聊天里的朋友，不像客服或播音员。",
          "你要判断用户这句话的意图：music 表示要排歌/换方向；chat 表示闲聊/提问；mixed 表示先回答再顺手调台。",
          "回复要短，具体，有人味。不要重复“我正在看你的歌单画像和这次的状态”。",
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
    if (!response.ok) return fallbackDialogueReply({ message: cleanMessage, activeTrack });
    const data = await response.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    const intent = ["music", "chat", "mixed"].includes(parsed.intent) ? parsed.intent : inferDialogueIntent(cleanMessage);
    const reply = cleanLine(parsed.reply).slice(0, 180);
    if (!reply) return fallbackDialogueReply({ message: cleanMessage, activeTrack });
    return { intent, reply, source: "llm" };
  } catch {
    return fallbackDialogueReply({ message: cleanMessage, activeTrack });
  }
}

export async function generateTalkScriptWithLlm({ track, context, fallbackScript }) {
  if (!isLlmConfigured()) return null;
  const config = getLlmConfig();
  const payload = {
    model: config.model,
    temperature: 0.82,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "你是 Claudio，一个像朋友一样的中文私人电台 DJ。",
          "根据当前歌曲、用户输入、用户画像和推荐依据，写真实贴合当下的口播。",
          "不要写主持腔、广告腔、功能说明、操作说明。",
          "不要泛泛而谈，每首歌必须不同，必须引用歌曲、用户状态、推荐依据里的具体信息。",
          "只能使用输入 JSON 中明确给出的信息；不要编造歌词、歌单名、用户曾经反复听过、歌曲背后的故事。",
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
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content);
    const directImport = hasDirectImportEvidence(track);
    const nextDirectImport = hasDirectImportEvidence(context.nextTrack);
    const sanitizerContext = { directImport, publicPlaylistNames: getPublicPlaylistNames(track) };
    const nextSanitizerContext = { directImport: nextDirectImport, publicPlaylistNames: getPublicPlaylistNames(track) };
    const opening = sanitizeTalkClaim(cleanLine(parsed.opening), sanitizerContext).slice(0, 150);
    const bridges = (Array.isArray(parsed.bridges) ? parsed.bridges : [])
      .map((line) => sanitizeTalkClaim(cleanLine(line), sanitizerContext).slice(0, 130))
      .filter(Boolean)
      .slice(0, 2);
    const nextTease = sanitizeTalkClaim(cleanLine(parsed.nextTease), nextSanitizerContext).slice(0, 150) || fallbackScript.nextTease || "";
    const closing = sanitizeTalkClaim(cleanLine(parsed.closing), sanitizerContext).slice(0, 120) || fallbackScript.closing || "";
    const recentLines = (context.recentLines || []).map((line) => cleanLine(line));
    if (isTooSimilarToRecent(opening, recentLines)) return null;
    if (!opening || bridges.length < 1) return null;
    const nextBridges = (bridges.length >= 2 ? bridges : [...bridges, fallbackScript.bridges?.[1]].filter(Boolean).slice(0, 2))
      .filter((line) => !isTooSimilarToRecent(line, recentLines));
    if (!nextBridges.length) return null;
    return {
      opening,
      bridges: nextBridges,
      nextTease,
      closing,
      lines: [opening, ...nextBridges, nextTease].filter(Boolean)
    };
  } catch {
    return null;
  }
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
  const { directImport = false, publicPlaylistNames = [] } = context;
  let clean = cleanLine(line);
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
  clean = removeLyricQuoteClaims(clean);
  clean = removePublicPlaylistNames(clean, publicPlaylistNames);
  return clean
    .replace(/我猜[^，。；]*(反复听过|某个晚上)[，。；]?/g, "")
    .replace(/你反复听过/g, "你可能会熟悉")
    .replace(/\s+/g, " ")
    .trim();
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
    const recentKey = normalizeForSimilarity(recent);
    if (!recentKey) return false;
    const sharedPhrase = linePhrases.some((phrase) => signaturePhrases(recent).includes(phrase));
    return sharedPhrase || key.includes(recentKey.slice(0, 14)) || recentKey.includes(key.slice(0, 14)) || overlapScore(key, recentKey) > 0.62;
  });
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

function fallbackDialogueReply({ message, activeTrack } = {}) {
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
  return {
    intent,
    source: "rules",
    reply: "好，我按这句话重新接一段。先不急着堆歌名，我会把情绪、曲风和可播音源一起筛一遍。"
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
