const DEFAULT_VOICE_ID = "city-music-editor-friend";

const VOICES = {
  [DEFAULT_VOICE_ID]: {
    id: DEFAULT_VOICE_ID,
    label: "城市音乐编辑 + 朋友低声",
    tone: "懂歌、懂场景，但像朋友在旁边轻声说话",
    talkDensity: "medium",
    materialPriority: [
      "songFacts",
      "userRequest",
      "songContext",
      "broadcastContext",
      "programSlot",
      "nextTrack"
    ],
    mustMention: ["歌名或歌手", "用户这次的场景或曲风"],
    mustUseWhenAvailable: ["评论/热评故事", "北京地铁口、环路、天气或资讯背景"],
    bannedPhrases: [
      "情绪路线",
      "气口",
      "主线",
      "慢慢听",
      "很稳",
      "接住",
      "往下走",
      "负责把",
      "私人时间",
      "自留地",
      "今晚这一段",
      "这首歌很适合你",
      "不把话说满"
    ],
    lineRules: {
      openingMinChars: 34,
      openingMaxChars: 108,
      bridgeMinChars: 32,
      bridgeMaxChars: 118,
      nextMinChars: 28,
      nextMaxChars: 96
    },
    styleDirective: [
      "默认声音是城市音乐编辑 + 朋友低声。",
      "每段先抓住歌名或歌手，再说明它和用户命题的关系。",
      "如果有北京、地铁口、环路、天气、评论或资讯素材，要挑一两个具体点揉进去。",
      "语气像懂歌的朋友，不像主持人、公众号或客服。",
      "不要写抽象判断，不要承诺播放列表外的歌。"
    ].join("")
  },
  "story-narrator": {
    id: "story-narrator",
    label: "故事叙事型",
    tone: "把热评和私人故事讲清楚，但不煽情",
    talkDensity: "rich",
    materialPriority: ["songContext", "songFacts", "userRequest", "nextTrack"],
    mustMention: ["歌名或歌手", "评论故事"],
    mustUseWhenAvailable: ["评论/热评故事"],
    bannedPhrases: ["情绪路线", "气口", "慢慢听", "自留地"],
    lineRules: {
      openingMinChars: 36,
      openingMaxChars: 112,
      bridgeMinChars: 36,
      bridgeMaxChars: 122,
      nextMinChars: 28,
      nextMaxChars: 96
    },
    styleDirective: "多用评论、故事、告别、重逢等素材，但不要复述原评论，也不要编造细节。"
  },
  "music-editor": {
    id: "music-editor",
    label: "音乐编辑型",
    tone: "更专业地解释曲风、歌手和队列关系",
    talkDensity: "medium",
    materialPriority: ["songFacts", "nextTrack", "userRequest", "broadcastContext"],
    mustMention: ["歌名或歌手", "曲风或场景"],
    mustUseWhenAvailable: ["曲风、场景、下一首"],
    bannedPhrases: ["情绪路线", "气口", "慢慢听", "自留地"],
    lineRules: {
      openingMinChars: 34,
      openingMaxChars: 104,
      bridgeMinChars: 30,
      bridgeMaxChars: 110,
      nextMinChars: 28,
      nextMaxChars: 94
    },
    styleDirective: "偏音乐编辑，解释曲风、歌手、节奏和下一首的关系，少讲泛情绪。"
  },
  "quiet-friend": {
    id: "quiet-friend",
    label: "朋友低声型",
    tone: "更安静，少信息，多陪伴",
    talkDensity: "low",
    materialPriority: ["userRequest", "songFacts", "nextTrack"],
    mustMention: ["歌名或歌手"],
    mustUseWhenAvailable: ["用户当下场景"],
    bannedPhrases: ["情绪路线", "气口", "慢慢听", "自留地"],
    lineRules: {
      openingMinChars: 26,
      openingMaxChars: 86,
      bridgeMinChars: 24,
      bridgeMaxChars: 92,
      nextMinChars: 22,
      nextMaxChars: 82
    },
    styleDirective: "像朋友轻声说一句，短、具体、不解释太多。"
  }
};

export function getTalkVoiceProfile(id = "default") {
  const key = id === "default" ? DEFAULT_VOICE_ID : id;
  return cloneVoice(VOICES[key] || VOICES[DEFAULT_VOICE_ID]);
}

export function buildTalkVoiceProfile(brief = {}, requestedId = "default") {
  const profile = getTalkVoiceProfile(requestedId);
  if (brief.format === "city-editorial") {
    profile.talkDensity = "rich";
    profile.styleDirective = [
      profile.styleDirective,
      `这期是${brief.city || "北京"}${brief.scene || "回家路上"}的城市编辑节目；优先使用歌名、歌手、北京、地铁口、环路、评论、资讯这些具体信息。`
    ].join("");
  }
  return profile;
}

export function scoreTalkLineQuality(line = "", profile = getTalkVoiceProfile()) {
  const text = cleanText(line);
  const reasons = [];
  if (!text) reasons.push("空文本");
  const banned = (profile.bannedPhrases || []).filter((phrase) => phrase && text.includes(phrase));
  if (banned.length) reasons.push(`命中禁用词：${banned.join("、")}`);
  if (/情绪.{0,4}(路线|很稳|主线)|慢慢听|气口|自留地|私人时间/.test(text)) {
    reasons.push("抽象电台腔");
  }
  if (/这首歌很适合你|今晚这一段|不把话说满|刚才这一分钟|重点不是煽情|能跟上的拍子|情绪会从|慢慢换一口气|这里不用只谈心情|点到为止|别盖过音乐/.test(text)) {
    reasons.push("模板句");
  }
  if (text.length > 0 && !/[《》]|北京|地铁口|环路|评论|资讯|新闻|天气|外面|今晚|AI|应用|歌手|歌名|下班|回家|民谣|R&B|粤语|华语/.test(text)) {
    reasons.push("缺少具体锚点");
  }
  return {
    ok: reasons.length === 0,
    reasons
  };
}

function cloneVoice(profile) {
  return JSON.parse(JSON.stringify(profile));
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}
