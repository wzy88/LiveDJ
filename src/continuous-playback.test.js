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

test("an explicit empty talk stage list preserves the program clock music-only window", () => {
  assert.match(main, /const stages = Array\.isArray\(script\.stages\)\s*\? script\.stages\s*: buildFallbackTalkStages\(script, track\);/);
  assert.doesNotMatch(main, /Array\.isArray\(script\.stages\) && script\.stages\.length/);
});

test("live dj only shows a line that is actually scheduled to play", () => {
  assert.match(main, /const scheduledOpening = Array\.isArray\(track\.script\?\.stages\)\s*\? track\.script\.stages\[0\]\?\.text\s*: track\.script\?\.opening;/);
  assert.match(main, /if \(scheduledOpening\) setDjLine\(scheduledOpening\);/);
  assert.doesNotMatch(main, /setDjLine\(track\.script\?\.opening \|\| `正在播放/);
});

test("music prompt primes audio before async dialogue and starts generated queue through autoplay path", () => {
  assert.match(main, /if \(fallbackIntent === "music"\) \{\s*primeAudioElement\(\);\s*\}/);
  assert.ok(
    main.indexOf('if (fallbackIntent === "music")') < main.indexOf('const intentProbe = await fetchJson("/api/dialogue"'),
    "music prompt must prime audio before the first awaited request"
  );
  assert.match(main, /if \(!appendAfterCurrent && nextQueue\.length\) \{\s*await continuePlaybackFromIndex\(0, nextQueue\);\s*\}/);
});

test("music queue result reply is softened by the LLM before entering chat", () => {
  assert.match(main, /async function buildNaturalProgramReply\(program, \{ mode, query, fallbackReply \}\)/);
  assert.match(main, /const fallbackReply = buildProgramReadyReply\(program, \{ mode, query: nextQuery \}\);/);
  assert.match(main, /const reply = await buildNaturalProgramReply\(program, \{\s*mode,\s*query: nextQuery,\s*fallbackReply\s*\}\);/);
  assert.match(main, /fetchJson\("\/api\/program-reply", \{\s*method: "POST",\s*body: JSON\.stringify\(\{\s*message: query,\s*mode,\s*fallbackReply,/);
});
