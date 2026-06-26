import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");

test("prompt input shows the example as placeholder instead of prefilled text", () => {
  assert.match(main, /const \[query, setQuery\] = useState\("今晚下班路上，想听一点华语、松弛、但不要太丧"\);/);
  assert.match(main, /const \[promptText, setPromptText\] = useState\(""\);/);
  assert.match(main, /<input value=\{promptText\} onChange=\{\(event\) => setPromptText\(event\.target\.value\)\} placeholder=\{query \|\| "跟 Claudio 说一句\.\.\."\} \/>/);
});

test("desktop now playing copy top and transport bottom align to the cover", () => {
  const nowRailBlock = cssRule(".nowRail");
  const nowStackBlock = cssRule(".nowStack");
  const nowCopyBlock = cssRule(".nowCopy");
  const nowStackPlacementBlock = cssRule(".nowRail > .nowStack", "margin-left");
  const transportBlock = cssRule(".transport");

  assert.match(nowRailBlock, /--cover-size:\s*clamp\(170px,\s*38%,\s*214px\);/);
  assert.match(nowRailBlock, /--copy-offset:\s*calc\(var\(--cover-size\) \+ 32px\);/);
  assert.match(nowStackBlock, /display:\s*grid;/);
  assert.match(nowStackBlock, /height:\s*var\(--cover-size\);/);
  assert.match(nowStackBlock, /grid-template-rows:\s*auto minmax\(18px,\s*1fr\) auto;/);
  assert.match(nowStackBlock, /padding-top:\s*0;/);
  assert.match(nowCopyBlock, /padding-top:\s*0;/);
  assert.match(nowStackPlacementBlock, /margin-left:\s*var\(--copy-offset\);/);
  assert.match(transportBlock, /grid-row:\s*3;/);
  assert.match(transportBlock, /margin:\s*0;/);
});

test("tablet now playing layout keeps transport below the song copy", () => {
  const tabletBlock = mediaBlock("1080px");

  assert.match(tabletBlock, /\.nowRail > \.nowStack\s*\{[\s\S]*grid-row:\s*1;/);
  assert.match(tabletBlock, /\.transport\s*\{[\s\S]*grid-row:\s*2;/);
  assert.match(tabletBlock, /\.volumeRow\s*\{[\s\S]*grid-row:\s*3;/);
  assert.match(tabletBlock, /\.nowQueuePanel\s*\{[\s\S]*grid-row:\s*4;/);
});

test("small now playing layout keeps copy, transport, volume, and queue on separate grid rows", () => {
  const mobileBlock = mediaBlock("520px");

  assert.match(mobileBlock, /\.nowRail\s*\{[\s\S]*grid-template-rows:\s*auto auto auto minmax\(260px,\s*1fr\);/);
  assert.match(mobileBlock, /\.nowRail > \.nowStack\s*\{[\s\S]*grid-row:\s*1;/);
  assert.match(mobileBlock, /\.transport\s*\{[\s\S]*grid-row:\s*2;/);
  assert.match(mobileBlock, /\.volumeRow\s*\{[\s\S]*grid-row:\s*3;/);
  assert.match(mobileBlock, /\.nowQueuePanel\s*\{[\s\S]*grid-row:\s*4;/);
});

test("live dj uses paged three-line copy in a fixed-height module", () => {
  const liveDjBlock = cssRule(".liveDjPanel");
  const liveDjTextBlock = cssRule(".liveDjText");
  const talkControlsBlock = cssRule(".talkControls");

  assert.match(main, /const liveDjPageChars = 96;/);
  assert.match(main, /function splitTalkPages\(text, maxChars\)/);
  assert.match(main, /const djLinePages = useMemo\(\(\) => splitTalkPages\(djLine, liveDjPageChars\), \[djLine\]\);/);
  assert.match(main, /setDjPageIndex\(\(index\) => \(index \+ 1\) % djLinePages\.length\);/);
  assert.match(main, /<p className="liveDjText" aria-live="polite">\{visibleDjLine\}<\/p>/);

  assert.match(liveDjBlock, /height:\s*214px;/);
  assert.match(liveDjBlock, /flex:\s*0 0 214px;/);
  assert.match(liveDjBlock, /grid-template-rows:\s*minmax\(0,\s*1fr\) auto;/);
  assert.match(liveDjTextBlock, /display:\s*-webkit-box;/);
  assert.match(liveDjTextBlock, /-webkit-line-clamp:\s*3;/);
  assert.match(liveDjTextBlock, /max-height:\s*calc\(1\.62em \* 3\);/);
  assert.match(liveDjTextBlock, /font-size:\s*clamp\(20px,\s*1\.45vw,\s*28px\);/);
  assert.match(liveDjTextBlock, /width:\s*min\(100%,\s*980px\);/);
  assert.match(liveDjTextBlock, /padding-right:\s*58px;/);
  assert.match(talkControlsBlock, /margin-top:\s*18px;/);
}
);

test("frequency scope has a simple animated sweep", () => {
  const frequencyBlock = cssRule(".frequencyScope", "--scan-x");
  const cursorLineBlock = cssRule(".frequencyCursorLine");
  const cursorDotBlock = cssRule(".frequencyCursorDot");
  const reducedMotionBlock = mediaBlock("prefers-reduced-motion: reduce");

  assert.match(main, /className="frequencyWave"/);
  assert.match(main, /className="frequencyCursorLine"/);
  assert.match(main, /className="frequencyCursorDot"/);
  assert.match(frequencyBlock, /--scan-x:\s*292px;/);
  assert.match(cursorLineBlock, /animation:\s*frequencyScan 4\.8s ease-in-out infinite;/);
  assert.match(cursorDotBlock, /animation:\s*frequencyScan 4\.8s ease-in-out infinite, frequencyPulse 1\.6s ease-in-out infinite;/);
  assert.match(styles, /@keyframes frequencyScan/);
  assert.match(styles, /@keyframes frequencyPulse/);
  assert.match(reducedMotionBlock, /\.frequencyCursorLine,\s*\n\s*\.frequencyCursorDot\s*\{[\s\S]*animation:\s*none;/);
});

function mediaBlock(maxWidth) {
  const query = maxWidth.includes(":") ? `@media (${maxWidth})` : `@media (max-width: ${maxWidth})`;
  const start = styles.indexOf(query);
  assert.notEqual(start, -1, `missing ${query} media query`);
  const next = styles.indexOf("\n@media ", start + 1);
  return next === -1 ? styles.slice(start) : styles.slice(start, next);
}

function cssRule(selector, containing = "") {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+");
  const matches = [...styles.matchAll(new RegExp(`${escaped}\\s*\\{[\\s\\S]*?\\n\\}`, "g"))].map((match) => match[0]);
  const match = containing ? matches.find((block) => block.includes(containing)) : matches[0];
  assert.ok(match, `missing css rule ${selector}${containing ? ` containing ${containing}` : ""}`);
  return match;
}
