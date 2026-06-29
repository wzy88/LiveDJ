import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");

test("track ended path continues through a dedicated autoplay helper", () => {
  assert.match(main, /async function continuePlaybackFromIndex\(startIndex, queue = queueRef\.current\)/);
  assert.match(main, /if \(queue\[nextIndex\]\) \{\s*await continuePlaybackFromIndex\(nextIndex, queue\);\s*return;\s*\}/);
  assert.match(main, /if \(program\?\.queue\?\.length\) \{\s*await continuePlaybackFromIndex\(0, program\.queue\);\s*\}/);
});

test("continuous playback prepares the media element before calling play", () => {
  assert.match(main, /audio\.src = toAudioSource\(track\.resolvedTrack\.streamUrl\);/);
  assert.match(main, /audio\.load\(\);/);
  assert.match(main, /await playTrackAtIndex\(index, queue, \{ allowMutedAutoplayRetry: true \}\);/);
  assert.match(main, /await playMusicAudio\(audio, \{\s*allowMutedAutoplayRetry: Boolean\(options\.allowMutedAutoplayRetry\)\s*\}\);/);
});

test("music prompt primes audio before async dialogue and starts generated queue through autoplay path", () => {
  assert.match(main, /if \(fallbackIntent === "music"\) \{\s*primeAudioElement\(\);\s*\}/);
  assert.ok(
    main.indexOf('if (fallbackIntent === "music")') < main.indexOf('const intentProbe = await fetchJson("/api/dialogue"'),
    "music prompt must prime audio before the first awaited request"
  );
  assert.match(main, /if \(!appendAfterCurrent && nextQueue\.length\) \{\s*await continuePlaybackFromIndex\(0, nextQueue\);\s*\}/);
});

test("silent audio priming does not mark the real player as playing", () => {
  assert.match(main, /const audioPrimingRef = useRef\(false\);/);
  assert.match(main, /audioPrimingRef\.current = true;\s*audioRef\.current\.src = silentUrlRef\.current;/);
  assert.match(main, /if \(audioPrimingRef\.current\) \{\s*setIsPlaying\(false\);\s*return;\s*\}/);
});

test("queue generation can opt into autoplay after an explicit music request", () => {
  assert.match(main, /async function loadRecommendations\(queryOverride = query, options = \{\}\)/);
  assert.match(main, /if \(options\.autoStart && !options\.appendAfterCurrent && mergedQueue\.length\) \{\s*await continuePlaybackFromIndex\(0, mergedQueue\);\s*\}/);
});

test("playlist import updates taste profile without interrupting the active program", () => {
  const importBody = main.match(/async function importPlaylist\(\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(importBody, "importPlaylist body should be present");
  assert.doesNotMatch(importBody, /primeAudioElement\(\)/);
  assert.doesNotMatch(importBody, /loadRecommendations\(/);
  assert.doesNotMatch(main, /导入并重排|现在按你的歌单重排/);
});

test("playlist import closes the modal before waiting on network import", () => {
  const importBody = main.match(/async function importPlaylist\(\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(importBody, "importPlaylist body should be present");
  assert.match(importBody, /const validationError = validatePlaylistImportInput/);
  assert.ok(
    importBody.indexOf("setIsImportPanelOpen(false);") < importBody.indexOf("await importPlaylist"),
    "modal should close before the first awaited import request"
  );
});
