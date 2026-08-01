import assert from "node:assert/strict";
import test from "node:test";

import { assignProgramClock, buildProgramClockStages } from "./program-clock.js";

function makeTracks(count = 6) {
  return Array.from({ length: count }, (_, index) => ({
    id: `track-${index + 1}`,
    title: `歌曲 ${index + 1}`
  }));
}

function makeScript(index = 0) {
  return {
    opening: `第 ${index + 1} 首的开场。后面还有一句不该进入微触碰。`,
    bridges: [
      "不用抬头，节奏还在。后面的事情慢慢来。",
      "把肩膀松一点，先看眼前这一小段。"
    ],
    nextTease: "后面会换一点颜色，但不会突然把你叫醒。",
    closing: "我们不在这里结束，后面的声音继续陪着。"
  };
}

test("program clock assigns a repeating six-track companionship block", () => {
  const tracks = assignProgramClock(makeTracks(8));

  assert.deepEqual(
    tracks.map((track) => track.programClock.role),
    [
      "block_open",
      "presence_touch",
      "callback",
      "trust_window",
      "mid_anchor",
      "soft_handoff",
      "block_open",
      "presence_touch"
    ]
  );
  assert.deepEqual(tracks.map((track) => track.programClock.blockIndex), [0, 0, 0, 0, 0, 0, 1, 1]);
  assert.deepEqual(tracks.map((track) => track.programClock.trackIndex), [0, 1, 2, 3, 4, 5, 0, 1]);
});

test("program clock produces six spoken stages with one fully silent song", () => {
  const tracks = assignProgramClock(makeTracks(6));
  const stages = tracks.map((track, index) => buildProgramClockStages(makeScript(index), track));

  assert.deepEqual(stages.map((items) => items.length), [1, 1, 1, 0, 1, 2]);
  assert.deepEqual(stages.flat().map((stage) => stage.type), [
    "block-open",
    "presence-touch",
    "callback",
    "mid-anchor",
    "presence-touch",
    "soft-handoff"
  ]);
  assert.equal(stages[1][0].text, "不用抬头，节奏还在。");
  assert.equal(stages[5][0].text, "第 6 首的开场。");
  assert.equal(stages[5][1].text, "后面会换一点颜色，但不会突然把你叫醒。");
  assert.ok(stages.flat().every((stage) => !stage.text.endsWith("……")));
});

test("soft handoff replaces hard-ending copy with continued presence", () => {
  const [track] = assignProgramClock(makeTracks(6)).slice(5);
  const script = makeScript(5);
  script.nextTease = "最后这点时间不用再补话，让声音自己收住。";

  const stages = buildProgramClockStages(script, track);
  const handoff = stages.find((stage) => stage.type === "soft-handoff");

  assert.doesNotMatch(handoff.text, /最后|到这里|结束|不用再补话/);
  assert.match(handoff.text, /继续|还在|再回来/);
});
