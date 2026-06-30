import assert from "node:assert/strict";
import test from "node:test";

import { mergeQueueAfterCurrent, mergeQueueAtTail, resolveQueueRequestAction, shouldQueueAfterCurrent } from "./queue-behavior.js";

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

test("mergeQueueAtTail keeps all current tracks and dedupes incoming backfill", () => {
  const current = [
    { id: "a", title: "正在播" },
    { id: "b", title: "旧下一首" }
  ];
  const incoming = [
    { id: "b", title: "重复旧歌" },
    { id: "x", title: "后台补 1" },
    { id: "y", title: "后台补 2" },
    { id: "x", title: "重复补歌" }
  ];

  const merged = mergeQueueAtTail(current, incoming);

  assert.deepEqual(merged.map((track) => track.id), ["a", "b", "x", "y"]);
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

test("resolveQueueRequestAction appends ambiguous music requests during active playback", () => {
  assert.equal(
    resolveQueueRequestAction("我想听李宗盛的歌", { hasActiveTrack: true }),
    "append"
  );
  assert.equal(
    resolveQueueRequestAction("播点节奏感强的提提神", { hasActiveTrack: true }),
    "append"
  );
  assert.equal(
    resolveQueueRequestAction("后面接几首李宗盛", { hasActiveTrack: true }),
    "append"
  );
});

test("resolveQueueRequestAction only replaces active playback for explicit immediate commands", () => {
  assert.equal(
    resolveQueueRequestAction("现在立刻播放李宗盛", { hasActiveTrack: true }),
    "replace"
  );
  assert.equal(
    resolveQueueRequestAction("直接切歌，换成民谣", { hasActiveTrack: true }),
    "replace"
  );
  assert.equal(
    resolveQueueRequestAction("重新排一下今晚的节目", { hasActiveTrack: true }),
    "replace"
  );
  assert.equal(
    resolveQueueRequestAction("我想听李宗盛的歌", { hasActiveTrack: false }),
    "replace"
  );
});
