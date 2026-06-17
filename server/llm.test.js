import assert from "node:assert/strict";
import test from "node:test";

process.env.LLM_API_KEY = process.env.LLM_API_KEY || "test-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "test-model";

const { generateTalkScriptWithLlm } = await import("./llm.js");

test("talk script sanitizer removes lyric quotes and raw public playlist names", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                opening: "刚下班吧？这首《海屿你》从你导入的歌单里跳出来，收尾那句“你离开我，就是旅行的意义”很适合现在。",
                bridges: [
                  "歌词里那句“Follow”不要讲太满，先把情绪放低一点。",
                  "你导入的歌单里那些旋律，其实都在等这样一首歌来串起。"
                ],
                nextTease: "下一首《旅行的意义》，也来自你的歌单，等这首歌尾巴那句“爱”收住，我们接到它。",
                closing: "从「温柔予你」转出来。"
              })
            }
          }
        ]
      };
    }
  });

  const script = await generateTalkScriptWithLlm({
    track: {
      title: "旅行的意义",
      artist: "陈绮贞",
      evidence: ["和你导入的歌单接近"],
      sources: [{ title: "温柔予你" }, { title: "旋律陷阱" }]
    },
    context: {
      query: "根据我导入的歌单来一段，少讲大道理",
      nextTrack: {
        title: "旅行的意义",
        artist: "陈绮贞",
        evidence: ["和你歌单里的《夜车》常在同类公开歌单共现"]
      }
    },
    fallbackScript: {
      opening: "先从这首开始。",
      bridges: ["这里少讲一点。"],
      nextTease: "后面继续顺着走。",
      closing: ""
    }
  });

  assert.ok(script);
  const joined = script.lines.join("\n");
  assert.doesNotMatch(joined, /收尾那句|歌词里那句|歌尾巴那句/);
  assert.doesNotMatch(joined, /“[^”]+”/);
  assert.doesNotMatch(joined, /温柔予你|旋律陷阱/);
  assert.doesNotMatch(joined, /从你导入的歌单里|你导入的歌单里/);
  assert.doesNotMatch(joined, /下一首[\s\S]{0,60}来自(?:你导入的|你的)歌单/);
});

test("talk script sanitizer does not project direct import evidence onto next track", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                opening: "这首歌来自你导入的歌单，先把夜晚放轻一点。",
                bridges: ["它和《夜车》的气质靠得很近。"],
                nextTease: "下一首《旅行的意义》，也来自你的歌单，会把这口气接到路上。",
                closing: ""
              })
            }
          }
        ]
      };
    }
  });

  const script = await generateTalkScriptWithLlm({
    track: {
      title: "海屿你",
      artist: "马也_Crabbit",
      evidence: ["来自你导入的歌单"],
      sources: []
    },
    context: {
      query: "下班松弛",
      nextTrack: {
        title: "旅行的意义",
        artist: "陈绮贞",
        evidence: ["和你歌单里的《夜车》常在同类公开歌单共现"]
      }
    },
    fallbackScript: {
      opening: "这首先接住你。",
      bridges: ["这里慢一点。"],
      nextTease: "下一首继续顺着走。",
      closing: ""
    }
  });

  assert.ok(script);
  assert.match(script.opening, /来自你导入的歌单/);
  assert.doesNotMatch(script.nextTease, /下一首[\s\S]{0,60}来自(?:你导入的|你的)歌单/);
});
