import assert from "node:assert/strict";
import test from "node:test";

import { buildProgramReadyReply, summarizeRejected } from "./program-reply.js";

test("program reply explains when requested artist was rejected instead of pretending it was queued", () => {
  const reply = buildProgramReadyReply({
    brief: {
      city: "北京",
      scene: "通勤路上",
      contentTaste: ["hot-comments", "news", "gossip"]
    },
    rejected: [
      { title: "最炫民族风", artist: "凤凰传奇", reason: "音源不可播或匹配不可靠" },
      { title: "自由飞翔", artist: "凤凰传奇", reason: "音源不可播或匹配不可靠" }
    ],
    queue: [
      { title: "逃向春天", artist: "凌晨一点的莱茵猫 / 洛米Gemini" },
      { title: "无尽幸福", artist: "凌晨一点的莱茵猫" }
    ]
  }, {
    query: "凤凰传奇 开车 北京 犯困 天气新闻娱乐八卦热评创作背景",
    mode: "append"
  });

  assert.match(reply, /凤凰传奇这轮没有接上/);
  assert.match(reply, /音源不可播或匹配不可靠/);
  assert.match(reply, /实际接上的是《逃向春天》-凌晨一点的莱茵猫/);
  assert.match(reply, /北京|通勤|热评|资讯|八卦/);
  assert.doesNotMatch(reply, /排好了|好，这次真的|后面再接|情绪路线|慢慢听/);
});

test("program reply keeps append mode explicit without interrupting current song", () => {
  const reply = buildProgramReadyReply([
    { title: "世间美好与你环环相扣", artist: "柏松" },
    { title: "无尽幸福", artist: "凌晨一点的莱茵猫" }
  ], { mode: "append" });

  assert.match(reply, /当前这首我不打断/);
  assert.match(reply, /新的队列会从下一首开始/);
  assert.doesNotMatch(reply, /现在切过去|立刻换/);
});

test("summarizeRejected can explain a failed requested artist from rejected rows", () => {
  const summary = summarizeRejected([
    { title: "最炫民族风", artist: "凤凰传奇", reason: "音源不可播或匹配不可靠" }
  ], "我说凤凰传奇");

  assert.equal(summary, "凤凰传奇这轮没有接上，主要是音源不可播或匹配不可靠。");
});
