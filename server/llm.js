const llmApiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
const llmApiBase = (process.env.LLM_API_BASE || "https://api.openai.com/v1").replace(/\/+$/, "");
const llmModel = process.env.LLM_MODEL || "";

export function isLlmConfigured() {
  return Boolean(llmApiKey && llmModel);
}

export async function generateTalkScriptWithLlm({ track, context, fallbackScript }) {
  if (!isLlmConfigured()) return null;
  const payload = {
    model: llmModel,
    temperature: 0.82,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "你是 Claudio，一个像朋友一样的中文私人电台 DJ。",
          "根据当前歌曲、用户输入、用户画像和推荐依据，写真实贴合当下的口播。",
          "不要写主持腔、广告腔、功能说明、操作说明。",
          "不要泛泛而谈，每首歌必须不同，必须引用歌曲或用户状态里的具体信息。",
          "只输出 JSON：{\"opening\":\"...\",\"bridges\":[\"...\",\"...\"]}。"
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
            sources: (track.sources || []).slice(0, 3).map((item) => item.title)
          },
          profile: {
            importedCount: context.profile?.importedTracks?.length || 0,
            importedTracks: (context.profile?.importedTracks || []).slice(0, 12).map((item) => ({
              title: item.title,
              artist: item.artist,
              matched: Boolean(item.match?.songId)
            }))
          },
          fallbackScript
        })
      }
    ]
  };

  try {
    const response = await fetch(`${llmApiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llmApiKey}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content);
    const opening = cleanLine(parsed.opening).slice(0, 180);
    const bridges = (Array.isArray(parsed.bridges) ? parsed.bridges : [])
      .map((line) => cleanLine(line).slice(0, 180))
      .filter(Boolean)
      .slice(0, 2);
    if (!opening || bridges.length < 1) return null;
    const nextBridges = bridges.length >= 2 ? bridges : [...bridges, fallbackScript.bridges?.[1]].filter(Boolean).slice(0, 2);
    return {
      opening,
      bridges: nextBridges,
      lines: [opening, ...nextBridges]
    };
  } catch {
    return null;
  }
}

function cleanLine(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim();
}
