import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");

test("track ended path continues through a dedicated autoplay helper", () => {
  assert.match(main, /async function continuePlaybackFromIndex\(startIndex, queue = queueRef\.current\)/);
  assert.match(main, /if \(queue\[nextIndex\]\) \{\s*await continuePlaybackFromIndex\(nextIndex, queue\);\s*void maybeBackfillQueue\(\{ reason: "track-ended" \}\);\s*return;\s*\}/);
  assert.match(main, /const backfill = await maybeBackfillQueue\(\{ reason: "track-ended", minimumRemaining: 0 \}\);/);
  assert.match(main, /if \(backfilledQueue\[nextIndex\]\) \{\s*await continuePlaybackFromIndex\(nextIndex, backfilledQueue\);/);
  assert.match(main, /if \(program\?\.queue\?\.length\) \{\s*await continuePlaybackFromIndex\(0, program\.queue\);\s*void maybeBackfillQueue\(\{ reason: "track-ended" \}\);\s*\}/);
});

test("continuous playback backfills the queue before it runs out", () => {
  assert.match(main, /const backfillPromiseRef = useRef\(null\);/);
  assert.match(main, /async function maybeBackfillQueue\(/);
  assert.match(main, /mergeQueueAtTail\(queueRef\.current, incomingQueue\)/);
  assert.match(main, /if \(remainingPlayableCount > minimumRemaining\) return null;/);
  assert.match(main, /void maybeBackfillQueue\(\{ reason: "play-start" \}\);/);
  assert.match(main, /void maybeBackfillQueue\(\{ reason: "track-ended" \}\);/);
  assert.match(main, /appendDjResponse: false/);
  assert.match(main, /const requestQueueToken = options\.appendToTail/);
  assert.match(main, /if \(requestQueueToken !== queueMutationSeqRef\.current\) \{/);
  assert.match(main, /if \(!options\.silent && !options\.appendAfterCurrent\) \{/);
  assert.doesNotMatch(main.match(/async function maybeBackfillQueue\([\s\S]*?\n  \}/)?.[0] || "", /appendDialogueMessage\(/);
});

test("continuous playback prepares the media element before calling play", () => {
  assert.match(main, /audio\.src = toAudioSource\(track\.resolvedTrack\.streamUrl\);/);
  assert.match(main, /audio\.load\(\);/);
  assert.match(main, /await playTrackAtIndex\(index, queue, \{ allowMutedAutoplayRetry: true \}\);/);
  assert.match(main, /await playMusicAudio\(audio, \{\s*allowMutedAutoplayRetry: Boolean\(options\.allowMutedAutoplayRetry\)\s*\}\);/);
});

test("talkover audio is prepared in the background without blocking music playback state", () => {
  assert.match(main, /const speechAudioCacheRef = useRef\(new Map\(\)\);/);
  assert.match(main, /function prepareSpeechAudio\(text\)/);
  assert.match(main, /const blob = await prepareSpeechAudio\(text\);/);
  assert.match(main, /voiceAudio\.onplaying = \(\) => \{\s*if \(token !== speechSeqRef\.current\) return;\s*setCurrentTalkSegment\(nextSegment\);/);
  assert.match(main, /prepareSpeechAudio\(line\)\.catch\(\(\) => \{\}\);/);
  assert.doesNotMatch(main, /正在准备口播/);
});

test("music prompt does not prime audio before queue action is resolved", () => {
  const submitBody = main.match(/async function handlePromptSubmit\(event\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(submitBody, "handlePromptSubmit body should be present");
  assert.doesNotMatch(submitBody, /primeAudioElement\(\)/);
});

test("generated queue primes audio only for immediate replacement playback", () => {
  const applyBody = main.match(/async function applyQueueRequest\(nextQuery, \{ mode = "replace" \} = \{\}\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(applyBody, "applyQueueRequest body should be present");
  assert.match(applyBody, /if \(!appendAfterCurrent\) \{\s*primeAudioElement\(\);\s*stopSpeechAndTimers\(\);\s*\}/);
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

test("definite music prompts skip stale dialogue probing before queue generation", () => {
  const submitBody = main.match(/async function handlePromptSubmit\(event\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(submitBody, "handlePromptSubmit body should be present");
  assert.match(submitBody, /if \(isDefiniteMusicRequest\(nextQuery\)\) \{/);
  assert.ok(
    submitBody.indexOf("if (isDefiniteMusicRequest(nextQuery))") < submitBody.indexOf('fetchJson("/api/dialogue"'),
    "definite music requests should generate a fresh queue before any dialogue reply can mention stale queue items"
  );
  assert.match(main, /function isDefiniteMusicRequest\(text = ""\)/);
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
