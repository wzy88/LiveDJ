const PROGRAM_CLOCK = [
  {
    role: "block_open",
    label: "开场锚点",
    playedFields: ["opening"],
    writingInstruction: "看见听众当下的状态，用一个具体场景建立这段陪伴，不要报幕。"
  },
  {
    role: "presence_touch",
    label: "轻触陪伴",
    playedFields: ["bridges.0"],
    writingInstruction: "只写一句很短的在场提醒，不解释歌曲，也不要求听众回应。"
  },
  {
    role: "callback",
    label: "前文回声",
    playedFields: ["opening"],
    writingInstruction: "承认时间已经过去，呼应前面说过的动作、状态或环境，让听众感到你记得。"
  },
  {
    role: "trust_window",
    label: "音乐留白",
    playedFields: [],
    writingInstruction: "这一首完整留给音乐，不生成也不播放口播。"
  },
  {
    role: "mid_anchor",
    label: "中场调整",
    playedFields: ["opening"],
    writingInstruction: "根据节目已经进行到中后段这一事实，具体调整能量、密度或情绪方向。"
  },
  {
    role: "soft_handoff",
    label: "柔性续接",
    playedFields: ["opening", "nextTease"],
    writingInstruction: "先用一句短触碰回来，再说明后面的声音会继续，不做节目结束式告别。"
  }
];

export function assignProgramClock(queue = [], { blockSize = PROGRAM_CLOCK.length } = {}) {
  const size = Math.max(1, Number(blockSize) || PROGRAM_CLOCK.length);
  queue.forEach((track, index) => {
    const trackIndex = index % size;
    const template = PROGRAM_CLOCK[trackIndex % PROGRAM_CLOCK.length];
    track.programClock = {
      blockIndex: Math.floor(index / size),
      trackIndex,
      ...template,
      playedFields: [...template.playedFields]
    };
  });
  return queue;
}

export function buildProgramClockStages(script = {}, track = {}) {
  const clock = track.programClock || PROGRAM_CLOCK[0];
  const opening = cleanText(script.opening || "");
  const bridges = Array.isArray(script.bridges) ? script.bridges.map(cleanText).filter(Boolean) : [];
  const nextTease = cleanText(script.nextTease || "");
  const closing = cleanText(script.closing || "");

  switch (clock.role) {
    case "presence_touch":
      return compactStages([
        makeStage(track, "presence-touch", "轻触陪伴", compactTouch(bridges[0] || opening), {
          position: "beforeEnd",
          beforeEndMs: 12000,
          minMs: 70000,
          musicVolume: 0.18
        })
      ]);
    case "callback":
      return compactStages([
        makeStage(track, "callback", "前文回声", opening || bridges[0], {
          position: "start",
          offsetMs: 1800,
          musicVolume: 0.2
        })
      ]);
    case "trust_window":
      return [];
    case "mid_anchor":
      return compactStages([
        makeStage(track, "mid-anchor", "中场调整", opening || bridges[0], {
          position: "start",
          offsetMs: 1800,
          musicVolume: 0.2
        })
      ]);
    case "soft_handoff":
      return compactStages([
        makeStage(track, "presence-touch", "轻触陪伴", compactTouch(opening || bridges[0]), {
          position: "start",
          offsetMs: 1800,
          musicVolume: 0.18
        }),
        makeStage(track, "soft-handoff", "柔性续接", softenHandoff(nextTease || closing), {
          position: "beforeEnd",
          beforeEndMs: 14000,
          minMs: 90000,
          musicVolume: 0.18
        })
      ]);
    case "block_open":
    default:
      return compactStages([
        makeStage(track, "block-open", "开场锚点", opening || bridges[0], {
          position: "start",
          offsetMs: 1400,
          musicVolume: 0.22
        })
      ]);
  }
}

function makeStage(track, type, label, text, timing) {
  return {
    id: `${track.id || "track"}:${type}`,
    type,
    label,
    text: cleanText(text),
    ...timing
  };
}

function compactStages(stages = []) {
  return stages.filter((stage) => stage.text);
}

function softenHandoff(value = "") {
  const text = cleanText(value);
  if (!text || /最后|到这里|节目结束|不用再补话/.test(text)) {
    return "这一首后面我先少说一点。声音还会继续，你手上的事不用重新开始。";
  }
  if (!/继续|后面|还在|再回来|下一/.test(text)) {
    return `${text} 后面的声音还会继续。`;
  }
  return text;
}

function compactTouch(value = "", maxChars = 32) {
  const text = cleanText(value);
  if (!text) return "";

  const firstSentenceEnd = text.search(/[。！？!?]/);
  if (firstSentenceEnd >= 0 && firstSentenceEnd < text.length - 1) {
    return text.slice(0, firstSentenceEnd + 1);
  }
  if (text.length <= maxChars) return finishSentence(text);

  const sentenceEnd = findFirstPunctuation(text, /[。！？!?]/, maxChars);
  if (sentenceEnd >= 0) return text.slice(0, sentenceEnd + 1);

  const clauseEnd = findLastPunctuation(text, /[，；;、,]/, maxChars);
  if (clauseEnd >= 7) return finishSentence(text.slice(0, clauseEnd));

  if (firstSentenceEnd >= 0) return text.slice(0, firstSentenceEnd + 1);
  return finishSentence(text);
}

function findFirstPunctuation(text, pattern, maxChars) {
  for (let index = 0; index < Math.min(text.length, maxChars); index += 1) {
    if (pattern.test(text[index])) return index;
  }
  return -1;
}

function findLastPunctuation(text, pattern, maxChars) {
  for (let index = Math.min(text.length, maxChars) - 1; index >= 0; index -= 1) {
    if (pattern.test(text[index])) return index;
  }
  return -1;
}

function finishSentence(value = "") {
  const text = cleanText(value).replace(/[，；;、,]+$/, "");
  if (!text || /[。！？!?]$/.test(text)) return text;
  return `${text}。`;
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}
