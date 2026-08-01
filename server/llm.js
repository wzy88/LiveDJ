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

export async function generateDialogueReplyWithLlm({ message, query, profile, activeTrack, queue, broadcastContext } = {}) {
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
          "如果用户问本地天气、本地新闻、今天发生什么、城市资讯，可以使用 broadcastContext 里的本地天气、本地新闻和城市编辑素材回答。",
          "有 newsBriefs 时可以讲新闻摘要；没有 newsBriefs 时要诚实说实时新闻源没接上，可以先讲天气和城市背景，不要编造具体新闻。",
          "禁用这些空泛词：情绪路线、气口、主线、慢慢听、很稳、接住、往下走、私人电台质感。",
          "如果用户问你的喜好，用 Claudio 的电台人格自然回答；不要说“我不用吃饭”“我没有身体”“我只是 AI”。",
          "不要解释你是 AI，不要写功能说明，不要写主持腔，不要编造输入里没有的实时事实。",
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
          broadcastContext: normalizeBroadcastContextForPrompt(broadcastContext, { queueIndex: 0 }),
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
    const intent = normalizeDialogueIntent({
      intent: ["music", "chat", "mixed"].includes(parsed.intent) ? parsed.intent : inferDialogueIntent(cleanMessage),
      message: cleanMessage
    });
    const reply = sanitizeDialogueReply(cleanLine(parsed.reply).slice(0, 180), {
      intent,
      message: cleanMessage,
      activeTrack,
      queue,
      broadcastContext
    });
    if (!reply) return fallbackDialogueReply({ message: cleanMessage, activeTrack, queue, broadcastContext });
    return { intent, reply, source: "llm" };
  } catch {
    return fallbackDialogueReply({ message: cleanMessage, activeTrack, queue });
  }
}

export async function generateProgramReplyWithLlm({ message, mode = "replace", program = {}, fallbackReply = "" } = {}) {
  const fallback = cleanLine(fallbackReply).slice(0, 260);
  if (!isLlmConfigured()) return { reply: fallback, source: "rules" };
  const config = getLlmConfig();
  const queue = Array.isArray(program.visibleQueue) ? program.visibleQueue : (Array.isArray(program.queue) ? program.queue : []);
  const payload = {
    model: config.model,
    temperature: 0.78,
    response_format: { type: "json_object" },
    ...providerPayloadOptions(config),
    messages: [
      {
        role: "system",
        content: [
          "你是 Claudio，一个中文私人电台 DJ，像微信聊天里的朋友，不像客服或播音员。",
          "现在排歌引擎已经给出最终结果。你的任务只是在不改变事实的前提下，把结果回复改写得自然一点。",
          "必须保留关键事实：哪些歌或歌手没接上、原因的大意、实际会播的第一首或下一首。",
          "可以把“音源不可播或匹配不可靠”改成人话，比如“这轮音源没过可播验证”或“我先不硬凑”。",
          "不要像系统日志，不要说“当前正在播/新的队列/稳定可播/匹配不可靠”这些工程词。",
          "不要承诺 program 里没有的歌曲，不要说已经接上被 rejected 的歌。",
          "回复 45-95 个中文字符，像聊天里发出的一句话。",
          "只输出 JSON：{\"reply\":\"...\"}。"
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          message: cleanLine(message).slice(0, 180),
          mode,
          fallbackReply: fallback,
          brief: compactObject({
            city: cleanLine(program.brief?.city || ""),
            scene: cleanLine(program.brief?.scene || ""),
            contentTaste: normalizeBriefTexts(program.brief?.contentTaste).slice(0, 4)
          }),
          rejected: (program.rejected || []).slice(0, 4).map((item) => ({
            title: cleanLine(item?.title || ""),
            artist: cleanLine(item?.artist || ""),
            reason: cleanLine(item?.reason || "")
          })),
          queue: queue.slice(0, 5).map((track) => ({
            title: cleanLine(track?.title || ""),
            artist: cleanLine(track?.artist || "")
          }))
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
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return { reply: fallback, source: "rules" };
    const data = await response.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    const reply = sanitizeProgramReply(cleanLine(parsed.reply).slice(0, 180), { fallbackReply: fallback, program });
    return reply ? { reply, source: "llm" } : { reply: fallback, source: "rules" };
  } catch {
    return { reply: fallback, source: "rules" };
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
          "写作方法：先抓住用户此刻在做什么或身体状态；再决定这一段口播要陪他做什么动作、经过什么环境、调整什么状态；最后只轻轻点一下歌曲里的可听见元素。不要把每段都写成“这首歌为什么适合现在”的证明题。",
          "同一轮节目里，每首歌要承担不同的陪伴功能：起步、进入状态、换一口气、稍微提亮、收住。不要每首都重复同一个物件、同一种身体感或同一种推荐理由。",
          "你的任务不是解释推荐算法，不要把标签翻译成句子；要把标签翻译成可感知的动作、画面和听感。",
          "如果有 talkBrief，把它当成电台编辑给你的写作任务：先回应用户命题，再把歌曲、热评/故事、歌手材料、天气、新闻、娱乐八卦和城市语境自然揉成一段。",
          "talkBrief.writingTask 要优先执行。scene_first / companion_scene_progression 时，核心是陪用户经历这个时刻，不是证明歌曲适配；material_anchored / answer_why_this_song_now 时，才需要回答为什么此刻放这首歌。整段口播合计控制在200-300字以内，再拆成 opening、bridges、nextTease。",
          "如果 talkBrief.programClock 存在，只重点写 playedFields 中真正会播出的字段，并严格执行 writingInstruction。节目钟优先于逐首完整解说。",
          "每次口播只保留一个清楚的编辑判断。不要为了显得有陪伴感，把手机、消息、窗外、风、灯、屏幕、房间、呼吸、暂停、重启、翻篇拼成一组氛围意象；用户输入没有这些物件时尤其不要主动添加。",
          "前奏、副歌、鼓点、乐器、人声位置和演唱质感等可听见细节，只能来自 track/contentPack.research/talkBrief.materials.songResearch 明确给出的资料；没有资料就不描写。",
          "不要虚构你和听众共同经历过的上次、以前、每次或固定习惯；只有输入明确提供的历史才能提。",
          "如果 talkBrief.programFunction 是 companion_scene_progression：opening 进入用户状态，bridge 用动作/身体/环境/目标推进，nextTease 轻轻转下一首；整段最多一两处明确讲音乐，不要连续写节奏、低频、踏频、注意力、托住。",
          "scene_first 可写的不是“歌为什么适合场景”，而是四类东西：用户正在做的下一个小动作、身体的松紧变化、周围环境的真实细节、目标推进到哪一小段。歌曲只作为陪伴存在，不要把音乐术语和场景动作硬拴在一起。",
          "如果 talkBrief.programFunction 是 answer_why_this_song_now，每段必须服务一个节目功能：opening 建立用户状态和当前歌曲，bridge 用一个具体听感或素材形成判断，nextTease 解释下一首如何接上。",
          "输出必须包含 angle 和 usedMaterials。angle 从 user_scene、comment_story、song_research、artist_context、city_editorial、transition、song_reason 中选；usedMaterials 写你实际使用的素材类型，例如 user_scene、song_reason、current_track、song_research、comment_story、artist_context、city_editorial、next_track。",
          "如果 talkBrief.mustMention 有内容，至少覆盖其中 3 个；如果 talkBrief.materials 有故事、歌手、城市资讯，至少使用 2 类素材。",
          "如果是 scene_first，写完后检查：是否像一个人在陪用户，而不是像一段推荐理由；如果是 material_anchored，检查是否同时覆盖用户诉求、当前歌曲和至少一个具体素材。",
          "差：这首歌节奏感强，适合下午办公防困。好：下午三点最怕歌一软，眼皮也跟着往下掉；这首的副歌和鼓点会隔几秒把你从表格里拎一下。",
          "差：这首歌是经典老歌，入口熟。好：它好在你不用重新认识，前奏一出来手指就知道该怎么跟着键盘敲。",
          "差：这一首放在这里收一下。好：前面几首已经把精神提起来了，这一首把音量降半格，让人继续工作，不被歌推着跑。",
          "scene_first 例子：骑行可以写“先别看平均速度，肩膀松一点，过了下个路口再决定要不要加一点”；不要写“低频配合踏频、不抢注意力、适合路况”。",
          "scene_first 例子：加班可以写“先把最小的一件事处理掉，回完那条消息，再看下一行字”；不要写“这首歌把状态托住、适合桌前工作”。",
          "如果有 showTalkPlan 和 contentPack，必须按节目级策划写：先服务这期节目，再服务单首歌。",
          "showTalkPlan 是整期节目大纲；contentPack 是当前歌曲的素材包，包括槽位、选择理由、故事和城市资讯。",
          "showTalkPlan.voiceProfile 是本期声音人格，优先级高于普通 DJ 口吻。默认是城市音乐编辑 + 朋友低声：具体、克制、有场景，不写主持腔。",
          "如果 voiceProfile 提供 bannedPhrases，输出不得包含这些词；如果提供 styleDirective，必须按它控制句子气质。",
          "不要写主持腔、广告腔、功能说明、操作说明。",
          "opening 必须从听众能理解的具体入口开始：当前时间、身体状态、动作场景、声音感受，或有 songContext 时用“评论里/有人说/网络上”。播放器界面已经显示歌名和歌手，口播不用承担报幕职责；能不写歌名歌手时就不写，尤其不要用歌名歌手当句子的主语。",
          "opening 不要用“这里”“走到这儿”“这一首负责”“换一个速度”“把频道...”这类内部编排或抽象转场词开头。",
          "不要泛泛而谈，每首歌必须不同，必须引用歌曲、用户状态、推荐依据里的具体信息。",
          "不要把场景词机械翻译成固定公式。例如骑车不等于每句都写踏频、轮子、码表；加班不等于每句都写屏幕、文档、注意力。场景只定底色，口播要有留白。",
          "禁用抽象电台腔：情绪路线、气口、主线、慢慢听、很稳、接住、往下走、负责把、私人时间。要换成具体歌名、歌手、场景、评论/故事或资讯点。",
          "尤其禁止只写“今晚的情绪路线很稳”“慢慢听”“把夜晚放轻一点”这类没有信息量的句子。",
          "只能使用输入 JSON 中明确给出的信息；不要编造歌词、歌单名、用户曾经反复听过、歌曲背后的故事。",
          "songContext 是已经抓取和清洗过的网易云评论/故事语境；hotCommentThemes/storySummary 用来概括，commentExcerpts 是允许短引用的评论原文摘录。",
          "如果 songContext.commentExcerpts 有内容，可以短引用其中一句，格式类似“评论里有一句：……”，但每段最多引用一句，不要连续复读评论。",
          "如果 songContext 为空，不要提热评、评论区、网友故事、歌曲背后故事。",
          "broadcastContext 只包含已提供的播出语境；可以自然使用 timeCue、weatherSummary、newsSummary、city、localSceneSummary、newsBriefs、cultureBriefs、editorialAngles。",
          "如果 weatherSummary 或 localSceneSummary 没有出现在输入里，不要主动补天气、温度、地铁口、环路、胡同口。",
          "必须服从 broadcastContext.timeCue：如果 timeCue 是早上、上午、中午或下午，禁止写今晚、夜里、下班路上、晚高峰、回家那十几分钟；只能写对应时段的工作间隙、午间、下午或当前场景。",
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
          "只输出 JSON：{\"angle\":\"user_scene|comment_story|artist_context|city_editorial|transition|song_reason\",\"usedMaterials\":[\"user_scene\",\"song_reason\",\"current_track\"],\"opening\":\"...\",\"bridges\":[\"...\",\"...\"],\"nextTease\":\"...\",\"closing\":\"...\"}。"
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
          songContext: shouldSuppressStoryMaterial(context) ? null : normalizeSongContextForPrompt(context.songContext),
          broadcastContext: normalizeBroadcastContextForPrompt(context.broadcastContext, { queueIndex: context.queueIndex || 0 }),
          brief: normalizeBriefForPrompt(context.brief),
          talkBrief: normalizeTalkBriefForPrompt(context.talkBrief),
          showTalkPlan: normalizeShowTalkPlanForPrompt(context.showTalkPlan),
          contentPack: normalizeContentPackForPrompt(context.contentPack, {
            queueIndex: context.queueIndex || 0,
            suppressStory: shouldSuppressStoryMaterial(context)
          }),
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
    const sanitizedOpening = sanitizeTalkClaim(cleanLine(parsed.opening), sanitizerContext);
    const opening = (shouldAnchorOpeningToTrack(context)
      ? ensureTrackAnchor(sanitizedOpening, track)
      : sanitizedOpening
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
    const materialGate = evaluateTalkScriptMaterialUse({
      parsed,
      opening,
      bridges,
      nextTease,
      track,
      context
    });
    if (!materialGate.ok) return makeRejectedScript(`material_gate:${materialGate.reasons.join(",")}`);
    const sceneFirstGate = evaluateSceneFirstTalkQuality({ opening, bridges, nextTease, context });
    if (!sceneFirstGate.ok) return makeRejectedScript(`scene_first_overexplained:${sceneFirstGate.reasons.join(",")}`);
    const groundingGate = evaluateTalkScriptGrounding({ opening, bridges, nextTease, track, context });
    if (!groundingGate.ok) return makeRejectedScript(`grounding_gate:${groundingGate.reasons.join(",")}`);
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

function normalizeTalkBriefForPrompt(talkBrief = {}) {
  if (!talkBrief || typeof talkBrief !== "object") return null;
  const userKeywords = compactObject({
    artists: normalizeBriefTexts(talkBrief.userKeywords?.artists),
    city: normalizeBriefTexts(talkBrief.userKeywords?.city),
    scene: normalizeBriefTexts(talkBrief.userKeywords?.scene),
    mood: normalizeBriefTexts(talkBrief.userKeywords?.mood),
    content: normalizeBriefTexts(talkBrief.userKeywords?.content)
  });
  const currentTrack = compactObject({
    title: cleanLine(talkBrief.currentTrack?.title || ""),
    artist: cleanLine(talkBrief.currentTrack?.artist || ""),
    materialSummary: cleanLine(talkBrief.currentTrack?.materialSummary || ""),
    selectionReason: cleanLine(talkBrief.currentTrack?.selectionReason || ""),
    scenes: normalizeBriefTexts(talkBrief.currentTrack?.scenes),
    moods: normalizeBriefTexts(talkBrief.currentTrack?.moods),
    genres: normalizeBriefTexts(talkBrief.currentTrack?.genres)
  });
  const nextTrack = compactObject({
    title: cleanLine(talkBrief.nextTrack?.title || ""),
    artist: cleanLine(talkBrief.nextTrack?.artist || ""),
    role: cleanLine(talkBrief.nextTrack?.role || "")
  });
  const materials = compactObject({
    story: cleanLine(talkBrief.materials?.story || "").slice(0, 420),
    songResearch: cleanLine(talkBrief.materials?.songResearch || "").slice(0, 420),
    artist: cleanLine(talkBrief.materials?.artist || "").slice(0, 360),
    cityEditorial: cleanLine(talkBrief.materials?.cityEditorial || "").slice(0, 420)
  });
  const programClock = compactObject({
    role: cleanLine(talkBrief.programClock?.role || ""),
    label: cleanLine(talkBrief.programClock?.label || ""),
    playedFields: normalizeBriefTexts(talkBrief.programClock?.playedFields).slice(0, 4),
    writingInstruction: cleanLine(talkBrief.programClock?.writingInstruction || "")
  });
  const normalized = compactObject({
    purpose: cleanLine(talkBrief.purpose || ""),
    programFunction: cleanLine(talkBrief.programFunction || ""),
    talkStrategy: cleanLine(talkBrief.talkStrategy || ""),
    primaryAngle: cleanLine(talkBrief.primaryAngle || ""),
    programClock,
    requiredMaterials: normalizeBriefTexts(talkBrief.requiredMaterials).slice(0, 8),
    segmentJobs: compactObject({
      opening: cleanLine(talkBrief.segmentJobs?.opening || ""),
      bridge: cleanLine(talkBrief.segmentJobs?.bridge || ""),
      nextTease: cleanLine(talkBrief.segmentJobs?.nextTease || "")
    }),
    userKeywords,
    currentTrack,
    nextTrack,
    materials,
    writingTask: cleanLine(talkBrief.writingTask || ""),
    qualityGate: normalizeBriefTexts(talkBrief.qualityGate).slice(0, 8),
    mustMention: normalizeBriefTexts(talkBrief.mustMention).slice(0, 8),
    bannedPhrases: normalizeBriefTexts(talkBrief.bannedPhrases).slice(0, 14)
  });
  return Object.keys(normalized).length ? normalized : null;
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

function normalizeContentPackForPrompt(pack = {}, { queueIndex = 0, suppressStory = false } = {}) {
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
  const research = compactObject({
    audibleCues: (pack.research?.audibleCues || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 5),
    backgroundFacts: (pack.research?.backgroundFacts || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 4),
    listenerAngles: (pack.research?.listenerAngles || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 4),
    talkSeeds: (pack.research?.talkSeeds || []).map((item) => cleanLine(item)).filter(Boolean).slice(0, 5),
    confidence: cleanLine(pack.research?.confidence || "")
  });
  const normalized = compactObject({
    programSlot,
    programSlotLabel,
    selectionReason,
    transitionRole,
    story: suppressStory ? null : story,
    artist,
    research,
    editorial
  });
  return Object.keys(normalized).length ? normalized : null;
}

function shouldSuppressStoryMaterial(context = {}) {
  const brief = context.brief || {};
  return brief.format === "personal-companion" && !(brief.contentTaste || []).length;
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

function evaluateTalkScriptMaterialUse({ parsed = {}, opening = "", bridges = [], nextTease = "", track = {}, context = {} } = {}) {
  const talkBrief = context.talkBrief || {};
  if (talkBrief.programFunction !== "answer_why_this_song_now") return { ok: true, reasons: [] };
  const joined = cleanLine([opening, ...(bridges || []), nextTease].filter(Boolean).join(" "));
  const reasons = [];
  const usedMaterials = normalizeMaterialTags(parsed.usedMaterials);
  const hasCurrentTrack = mentionsTrack(joined, track);
  const hasUserNeed = mentionsAnyBriefKeyword(joined, talkBrief.userKeywords);
  const hasConcreteMaterial = mentionsConcreteBriefMaterial(joined, talkBrief, context) ||
    (talkBrief.talkStrategy === "scene_first" && hasSceneFirstConcreteDetail(joined));
  const explainsWhy = hasWhyThisSongSignal(joined, talkBrief);
  const hasEditorialNeed = Boolean((talkBrief.userKeywords?.city || []).length || (talkBrief.userKeywords?.content || []).length);
  const usesOnlyCurrentTrack = usedMaterials.length === 1 && usedMaterials[0] === "current_track";
  if (!hasCurrentTrack) reasons.push("missing_current_track");
  if (!hasUserNeed) reasons.push("missing_user_need");
  if (!hasConcreteMaterial) reasons.push("missing_concrete_material");
  if (!explainsWhy) reasons.push("missing_song_reason");
  if (!usedMaterials.length) reasons.push("missing_used_materials");
  if (talkBrief.talkStrategy !== "scene_first" && hasEditorialNeed && usesOnlyCurrentTrack) reasons.push("missing_requested_editorial_material");
  return { ok: reasons.length === 0, reasons };
}

function evaluateSceneFirstTalkQuality({ opening = "", bridges = [], nextTease = "", context = {} } = {}) {
  if (context.talkBrief?.programFunction !== "companion_scene_progression") return { ok: true, reasons: [] };
  const joined = cleanLine([opening, ...(bridges || []), nextTease].filter(Boolean).join(" "));
  const lines = [opening, ...(bridges || []), nextTease].map(cleanLine).filter(Boolean);
  const reasons = [];
  const scene = cleanLine(context.brief?.scene || "");
  const proofWords = joined.match(/节奏|踏频|低频|R&B|rnb|注意力|托住|适合|不抢|配合|律动/g) || [];
  if (proofWords.length > 5) reasons.push("too_many_match_terms");
  if (/低频.{0,16}人声.{0,28}(踏频|节奏|注意力|托住)/i.test(joined)) reasons.push("music_terms_chained_to_scene");
  if (/节奏.{0,18}(踏频|注意力|托住|适合).{0,18}(踏频|注意力|托住|适合)/.test(joined)) reasons.push("repeated_rhythm_explanation");
  if (lines.some(hasProofySceneFirstLine)) reasons.push("proofy_scene_line");
  if (/骑行/.test(scene) && lines.some(hasCyclingSongFitLine)) reasons.push("cycling_song_fit_line");
  return { ok: reasons.length === 0, reasons };
}

function hasProofySceneFirstLine(line = "") {
  const clean = cleanLine(line);
  const matchTerms = clean.match(/节奏|踏频|低频|R&B|rnb|注意力|托住|适合|不抢|配合|律动|鼓点/g) || [];
  if (matchTerms.length >= 3) return true;
  if (/(低频|R&B|rnb|律动|鼓点|人声).{0,24}(踏频|踩踏|路况|注意力|速度|心率|目标|身体)/i.test(clean)) return true;
  if (/(节奏|律动).{0,18}(适合|配合|托住|维持|贴着|跟着).{0,18}(踏频|注意力|路况|目标|身体|工作|桌前)/.test(clean)) return true;
  if (/(适合|不抢).{0,12}(骑行|骑车|路上|路况|办公|工作|桌前|注意力)/.test(clean)) return true;
  if (/把状态托住|把.*托住|不用看码表也知道/.test(clean)) return true;
  return false;
}

function hasCyclingSongFitLine(line = "") {
  const clean = cleanLine(line);
  if (/(低频|R&B|rnb|明亮音色|音色|人声|律动)/i.test(clean)) return true;
  if (/(尾奏|前奏|副歌|间奏).{0,18}(缓坡|路|骑|配速|踏板|轮子)/.test(clean)) return true;
  if (/(铺得更满|声音铺|配速|码表)/.test(clean)) return true;
  if (/(不抢|适合).{0,14}(耳朵|路|路况|平路|骑|踏频|脚步|注意力)/.test(clean)) return true;
  if (/踏频/.test(clean)) return true;
  if (/节奏.{0,12}(脚步|踏板|踩|轮子|平路|路况)/.test(clean)) return true;
  return false;
}

function normalizeMaterialTags(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => cleanLine(item).toLowerCase().replace(/[-\s]+/g, "_"))
    .filter(Boolean)
    .slice(0, 12);
}

function mentionsAnyBriefKeyword(text = "", userKeywords = {}) {
  const clean = cleanLine(text);
  const keywords = [
    ...(userKeywords.artists || []),
    ...(userKeywords.city || []),
    ...(userKeywords.scene || []),
    ...(userKeywords.mood || []),
    ...(userKeywords.content || [])
  ].map((item) => cleanLine(item)).filter(Boolean);
  return keywords.some((keyword) => clean.includes(keyword));
}

function mentionsConcreteBriefMaterial(text = "", talkBrief = {}, context = {}) {
  const clean = cleanLine(text);
  const materials = talkBrief.materials || {};
  const materialSeeds = [
    ...extractMaterialSeeds(materials.story),
    ...extractMaterialSeeds(materials.songResearch),
    ...extractMaterialSeeds(materials.artist),
    ...extractMaterialSeeds(materials.cityEditorial),
    ...extractMaterialSeeds(talkBrief.currentTrack?.selectionReason),
    ...extractMaterialSeeds(context.songContext?.storySummary),
    ...((context.songContext?.commentExcerpts || []).flatMap((item) => extractMaterialSeeds(typeof item === "string" ? item : item?.text || ""))),
    ...extractMaterialSeeds(context.broadcastContext?.weatherSummary),
    ...normalizeBriefTexts(context.broadcastContext?.newsBriefs),
    ...normalizeBriefTexts(context.broadcastContext?.cultureBriefs),
    ...((context.broadcastContext?.editorialAngles || []).flatMap(extractMaterialSeeds))
  ];
  const uniqueSeeds = [...new Set(materialSeeds.map((item) => cleanLine(item)).filter((item) => item.length >= 2))];
  return uniqueSeeds.some((seed) => clean.includes(seed));
}

function hasSceneFirstConcreteDetail(text = "") {
  return /灯|屏幕|桌面|窗|夜色|手|肩膀|呼吸|声音|节奏|风|路口|键盘|消息|文件|耳朵|身体|房间|空气|速度|轮子|注意力/.test(cleanLine(text));
}

function evaluateTalkScriptGrounding({ opening = "", bridges = [], nextTease = "", track = {}, context = {} } = {}) {
  const joined = cleanLine([opening, ...(bridges || []), nextTease].filter(Boolean).join(" "));
  const reasons = [];
  if (hasGenericSceneCollage(joined, context)) reasons.push("generic_scene_collage");
  if (hasUnsupportedAudibleDetails(joined, track, context)) reasons.push("unsupported_audible_detail");
  if (hasInventedSharedMemory(joined, context)) reasons.push("invented_shared_memory");
  return { ok: reasons.length === 0, reasons };
}

function hasGenericSceneCollage(text = "", context = {}) {
  const clean = cleanLine(text);
  const supplied = cleanLine([
    context.query,
    context.broadcastContext?.weatherSummary,
    context.broadcastContext?.localSceneSummary,
    context.talkBrief?.materials?.cityEditorial
  ].filter(Boolean).join(" "));
  const motifGroups = [
    /手机|消息/,
    /窗外|窗边|窗前|窗户/,
    /风|夜风/,
    /灯|灯光|路灯/,
    /屏幕|光标/,
    /房间|屋里/,
    /呼吸|肩膀/,
    /暂停|重启|翻篇|重新开始/
  ];
  const inventedMotifCount = motifGroups.filter((pattern) => pattern.test(clean) && !pattern.test(supplied)).length;
  return inventedMotifCount >= 4;
}

function hasUnsupportedAudibleDetails(text = "", track = {}, context = {}) {
  const clean = cleanLine(text);
  const allowed = cleanLine([
    ...(track.genres || []).map((item) => item?.value || item),
    ...(track.moods || []).map((item) => item?.value || item),
    ...(context.contentPack?.research?.audibleCues || []),
    ...(context.contentPack?.research?.talkSeeds || []),
    context.talkBrief?.materials?.songResearch
  ].filter(Boolean).join(" "));
  const detailTerms = ["钢琴", "吉他", "贝斯", "鼓点", "鼓机", "弦乐", "合成器", "前奏", "副歌", "间奏", "尾奏", "和声", "女声", "男声", "气声", "人声位置"];
  const unsupported = detailTerms.filter((term) => clean.includes(term) && !allowed.includes(term));
  return unsupported.length >= 2;
}

function hasInventedSharedMemory(text = "", context = {}) {
  const clean = cleanLine(text);
  if (!/(我记得(?:上次|以前|你)|我们(?:上次|以前)|你(?:以前|每次|总是)|今天也照旧)/.test(clean)) return false;
  const suppliedHistory = cleanLine([
    context.query,
    ...(context.profile?.listeningHistory || []),
    ...(context.profile?.memories || [])
  ].filter(Boolean).join(" "));
  return !/(上次|以前|每次|总是|照旧)/.test(suppliedHistory);
}

function extractMaterialSeeds(value = "") {
  const clean = cleanLine(value);
  if (!clean) return [];
  return (clean.match(/[\u4e00-\u9fff]{2,8}|[A-Za-z0-9]{3,}/g) || [])
    .filter((item) => !/这首歌|评论里|有一句|新闻|资讯|编辑角度|热评主题|用户|需要|当前/.test(item))
    .slice(0, 18);
}

function hasWhyThisSongSignal(text = "", talkBrief = {}) {
  const clean = cleanLine(text);
  const selectionReason = cleanLine(talkBrief.currentTrack?.selectionReason || "");
  if (selectionReason && extractMaterialSeeds(selectionReason).some((seed) => clean.includes(seed))) return true;
  return /所以|因为|适合|先放|先听|用来|能把|可以把|正好|放在这里|接到/.test(clean);
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

function shouldAnchorOpeningToTrack(context = {}) {
  return context.talkBrief?.talkStrategy !== "scene_first";
}

function ensureNextTrackAnchor(line, nextTrack = null) {
  const clean = cleanLine(line);
  if (!clean || !nextTrack) return clean;
  if (mentionsTrack(clean, nextTrack)) return clean;
  const title = cleanLine(nextTrack.title || "");
  const artist = cleanLine(nextTrack.artist || "").split("/")[0].trim();
  if (title && artist) return `${clean}，待会儿接到《${title}》和${artist}的时候，会自然接上。`;
  if (title) return `${clean}，待会儿接到《${title}》的时候，会自然接上。`;
  return clean;
}

function mentionsTrack(line, track = {}) {
  const clean = cleanLine(line);
  const title = cleanLine(track?.title || "");
  const artist = cleanLine(track?.artist || "").split("/")[0].trim();
  const normalized = normalizeTrackMentionText(clean);
  return Boolean(
    (title && (clean.includes(title) || normalized.includes(normalizeTrackMentionText(title)))) ||
    (artist && (clean.includes(artist) || normalized.includes(normalizeTrackMentionText(artist))))
  );
}

function normalizeTrackMentionText(value = "") {
  return cleanLine(value).replace(/[《》"'“”‘’（）()【】\[\]\s_-]/g, "").toLowerCase();
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
    .replace(/别让同一段城市背景抢走音乐[，。；]?/g, "")
    .replace(/这一次把北京背景收轻一点[，。；]?/g, "")
    .replace(/这首先不再重复城市开场[，。；]?/g, "")
    .replace(/这比单纯的介绍更像一个真实入口/g, "这句评论可以把歌里的关系说得更具体")
    .replace(/这比单纯介绍《([^》]+)》更像一个真实入口/g, "这句评论可以把《$1》说得更具体")
    .replace(/主线/g, "线索")
    .replace(/慢慢听/g, "先听这首")
    .replace(/很稳/g, "比较顺")
    .replace(/接住/g, "接上")
    .replace(/往下走/g, "继续排")
    .replace(/继续往前走/g, "继续排")
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

function sanitizeDialogueReply(reply = "", { intent = "chat", message = "", activeTrack = null, queue = [], broadcastContext = null } = {}) {
  const clean = cleanLine(reply);
  if (!clean) return "";
  if (isCompanionInfoRequest(message)) {
    if (promisesUnqueuedSong(clean, queue, activeTrack)) return "";
    if (!hasLiveNewsBriefs(broadcastContext) && inventsSpecificLocalNews(clean, broadcastContext)) return "";
  }
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

function sanitizeProgramReply(reply = "", { fallbackReply = "", program = {} } = {}) {
  const clean = cleanLine(reply);
  if (!clean || hasAbstractRadioCopy(clean)) return "";
  const queue = Array.isArray(program.visibleQueue) ? program.visibleQueue : (Array.isArray(program.queue) ? program.queue : []);
  const rejected = Array.isArray(program.rejected) ? program.rejected : [];
  const mentionsQueued = mentionsAnyQueueTrack(clean, queue);
  const mentionsRejected = rejected.some((item) => {
    const title = cleanLine(item?.title || "");
    const artist = cleanLine(item?.artist || "").split("/")[0].trim();
    return Boolean((title && clean.includes(title)) || (artist && clean.includes(artist)));
  });
  if (queue.length && !mentionsQueued) return "";
  if (rejected.length && fallbackReply.includes("没有接上") && !mentionsRejected) return "";
  for (const item of rejected) {
    const title = cleanLine(item?.title || "");
    const artist = cleanLine(item?.artist || "").split("/")[0].trim();
    if (title && new RegExp(`(接上|先播|放|播)《?${escapeRegExp(title)}》?`).test(clean)) return "";
    if (artist && new RegExp(`(接上|先播|放|播).{0,8}${escapeRegExp(artist)}`).test(clean)) return "";
  }
  return clean;
}

function hasAbstractRadioCopy(value = "") {
  return /情绪路线|慢慢听|很稳|气口|主线|接住|往下走|继续往前|私人电台质感|可播音源|筛一遍/.test(value);
}

function promisesUnqueuedSong(reply = "", queue = [], activeTrack = null) {
  const clean = cleanLine(reply);
  const allowedTitles = new Set([
    cleanLine(activeTrack?.title || ""),
    ...(queue || []).map((track) => cleanLine(track?.title || ""))
  ].filter(Boolean));
  const mentionedTitles = [...clean.matchAll(/《([^》]{1,40})》/g)].map((match) => cleanLine(match[1])).filter(Boolean);
  if (mentionedTitles.some((title) => !allowedTitles.has(title))) return true;
  return /(顺手|后面|下一首|给你|我再|我会).{0,12}(续|接|放|播|排|推荐).{0,8}《/.test(clean);
}

function hasLiveNewsBriefs(broadcastContext = {}) {
  return (broadcastContext?.newsBriefs || []).some((item) => {
    if (typeof item === "string") return false;
    return !/test-editorial|editorial|rules/i.test(cleanLine(item?.source || ""));
  });
}

function inventsSpecificLocalNews(reply = "", broadcastContext = {}) {
  const clean = cleanLine(reply);
  if (!/(今天|下午|上午|今晚|本地|新闻|消息|发生|大事|刚刚)/.test(clean)) return false;
  const weather = cleanLine(broadcastContext?.weatherSummary || "");
  const city = cleanLine(broadcastContext?.city || "");
  const allowed = [
    weather,
    city,
    ...normalizeBriefTexts(broadcastContext?.newsBriefs),
    ...normalizeBriefTexts(broadcastContext?.cultureBriefs),
    ...(broadcastContext?.editorialAngles || []).map(cleanLine)
  ].filter(Boolean).join(" ");
  const suspiciousSeeds = clean.match(/[\u4e00-\u9fff]{2,8}/g) || [];
  return suspiciousSeeds.some((seed) => {
    if (/北京|今天|下午|上午|今晚|本地|新闻|天气|少云|多云|晴|风|实时新闻源|没接上|城市|资讯|这会儿|先不/.test(seed)) return false;
    return !allowed.includes(seed);
  });
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

function fallbackDialogueReply({ message, activeTrack, queue, broadcastContext } = {}) {
  const intent = normalizeDialogueIntent({ intent: inferDialogueIntent(message), message });
  if (intent === "chat") {
    if (isCompanionInfoRequest(message)) {
      const contextReply = buildCompanionInfoFallback({ activeTrack, broadcastContext });
      if (contextReply) {
        return {
          intent,
          source: "rules",
          reply: contextReply
        };
      }
    }
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

function buildCompanionInfoFallback({ activeTrack = null, broadcastContext = {} } = {}) {
  const weather = cleanLine(broadcastContext?.weatherSummary || "");
  const city = cleanLine(broadcastContext?.city || "北京") || "北京";
  const liveNews = hasLiveNewsBriefs(broadcastContext)
    ? normalizeBriefTexts(broadcastContext.newsBriefs).slice(0, 2)
    : [];
  const nowPlaying = activeTrack?.title ? `《${cleanLine(activeTrack.title)}》先不打断。` : "";
  if (liveNews.length) {
    return `${nowPlaying}${city}这会儿我看到的本地资讯里，比较适合边听边说的是：${liveNews.join("；")}。`;
  }
  if (weather) {
    return `${nowPlaying}实时新闻源这会儿没接上，我先不编具体新闻。${weather}；可以先聊聊这会儿的城市背景和你正在听的歌。`;
  }
  return `${nowPlaying}实时新闻源这会儿没接上，我先不编具体新闻。你可以继续听歌，我按现在这首和北京这条线陪你聊。`;
}

function normalizeDialogueIntent({ intent = "chat", message = "" } = {}) {
  if (isCompanionInfoRequest(message) && !hasExplicitMusicAction(message)) return "chat";
  return intent;
}

function isCompanionInfoRequest(message = "") {
  return /(新闻|资讯|本地|天气|今天.*(?:发生|有|新闻|消息)|讲讲|说说|聊聊)/.test(cleanLine(message));
}

function hasExplicitMusicAction(message = "") {
  return /(放|播|换|排|推荐|来点|来一首|想听).{0,12}(歌|音乐|老歌|民谣|粤语|华语|摇滚|说唱|爵士|电子)|(?:歌|音乐|老歌).{0,8}(放|播|换|排|推荐)/.test(cleanLine(message));
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
