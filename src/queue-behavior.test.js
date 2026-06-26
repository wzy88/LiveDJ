import assert from "node:assert/strict";
import test from "node:test";

import { mergeQueueAfterCurrent, resolveQueueRequestAction, shouldQueueAfterCurrent } from "./queue-behavior.js";

test("mergeQueueAfterCurrent keeps the current track and appends new queue after it", () => {
  const current = [
    { id: "a", title: "正在播" },
    { id: "b", title: "旧下一首" }
  ];
  const incoming = [
    { id: "x", title: "李宗盛 1" },
    { id: "y", title: "李宗盛 2" }
  ];

  const merged = mergeQueueAfterCurrent(current, incoming, 0);

  assert.deepEqual(merged.map((track) => track.id), ["a", "x", "y"]);
});

test("shouldQueueAfterCurrent treats next requests as queue edits, not immediate playback", () => {
  assert.equal(
    shouldQueueAfterCurrent("后面播放李宗盛的音乐", { hasActiveTrack: true, isPlaying: true }),
    true
  );
  assert.equal(
    shouldQueueAfterCurrent("现在播放李宗盛的音乐", { hasActiveTrack: true, isPlaying: true }),
    false
  );
  assert.equal(
    shouldQueueAfterCurrent("后面播放李宗盛的音乐", { hasActiveTrack: false, isPlaying: false }),
    false
  );
});

test("resolveQueueRequestAction asks before replacing an active program on ambiguous music requests", () => {
  assert.equal(
    resolveQueueRequestAction("我想听李宗盛的歌", { hasActiveTrack: true }),
    "ask"
  );
  assert.equal(
    resolveQueueRequestAction("后面接几首李宗盛", { hasActiveTrack: true }),
    "append"
  );
  assert.equal(
    resolveQueueRequestAction("现在立刻播放李宗盛", { hasActiveTrack: true }),
    "replace"
  );
  assert.equal(
    resolveQueueRequestAction("我想听李宗盛的歌", { hasActiveTrack: false }),
    "replace"
  );
});
