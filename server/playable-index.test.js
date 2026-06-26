import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { getCleanPlayableRecord, storePlayableRecord } from "./playable-index.js";

test("playable cache rejects DJ or altered versions for main radio tracks", () => {
  const songId = "cache-test-dirty-dj-version::artist";
  try {
    storePlayableRecord(songId, {
      id: "123",
      title: "夜空中最亮的星 (DjEwen版)",
      artist: "逃跑计划",
      album: "",
      durationSec: 240,
      streamUrl: "https://example.com/audio.mp3"
    });

    assert.equal(
      getCleanPlayableRecord(songId, { title: "夜空中最亮的星", artist: "逃跑计划" }),
      null
    );
  } finally {
    removePlayableRecordFromDisk(songId);
  }
});

function removePlayableRecordFromDisk(songId) {
  const file = new URL("../data/playable-index.json", import.meta.url);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  delete data.items[songId];
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
