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

test("header keeps backend controls out of the primary user surface", () => {
  const topActionsBlock = main.match(/<div className="topActions">[\s\S]*?<\/div>/)?.[0] || "";
  assert.ok(topActionsBlock, "top action block should be present");
  assert.doesNotMatch(topActionsBlock, /DeepSeek ·/);
  assert.doesNotMatch(topActionsBlock, /连接 DeepSeek/);
  assert.doesNotMatch(topActionsBlock, /className="tuneButton"/);
  assert.match(topActionsBlock, /className="adminEntryButton"/);
  assert.match(topActionsBlock, />\s*后台\s*<\/button>/);
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
  assert.match(liveDjTextBlock, /font-size:\s*16px;/);
  assert.match(liveDjTextBlock, /width:\s*min\(100%,\s*980px\);/);
  assert.match(liveDjTextBlock, /padding-right:\s*58px;/);
  assert.match(talkControlsBlock, /margin-top:\s*18px;/);
}
);

test("live dj desktop layout contract catches oversized copy and flexible height regressions", () => {
  assertLiveDjDesktopContract(styles);

  const oversizedCopyStyles = styles.replace(
    /(\.liveDjText\s*\{[\s\S]*?font-size:\s*)16px;/,
    "$128px;"
  );
  assert.throws(
    () => assertLiveDjDesktopContract(oversizedCopyStyles),
    /Live DJ text font size/
  );

  const flexiblePanelStyles = styles.replace(
    /(\.liveDjPanel\s*\{[\s\S]*?height:\s*)214px;/,
    "$1auto;"
  );
  assert.throws(
    () => assertLiveDjDesktopContract(flexiblePanelStyles),
    /Live DJ panel height/
  );
});

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

test("clock panel keeps the same footprint but gains sci-fi instrument layering", () => {
  const clockBlock = cssRule(".clockPanel");
  const clockAfterBlock = cssRule(".clockPanel::after");
  const readoutBeforeBlock = cssRule(".clockReadout::before");
  const readoutAfterBlock = cssRule(".clockReadout::after");
  const scopeBeforeBlock = cssRule(".frequencyScope::before");
  const scopeAfterBlock = cssRule(".frequencyScope::after");
  const reducedMotionBlock = mediaBlock("prefers-reduced-motion: reduce");

  assert.match(clockBlock, /height:\s*clamp\(170px,\s*19vh,\s*214px\);/);
  assert.match(clockBlock, /isolation:\s*isolate;/);
  assert.match(clockBlock, /contain:\s*paint;/);
  assert.match(clockAfterBlock, /animation:\s*clockPanelSweep 6\.8s ease-in-out infinite;/);
  assert.match(readoutBeforeBlock, /content:\s*"TIME SYNC";/);
  assert.match(readoutAfterBlock, /animation:\s*clockPulse 1\.8s ease-in-out infinite;/);
  assert.match(scopeBeforeBlock, /content:\s*"SIGNAL FIELD";/);
  assert.match(scopeAfterBlock, /background:\s*linear-gradient\(90deg,/);
  assert.match(styles, /@keyframes clockPanelSweep/);
  assert.match(styles, /@keyframes clockPulse/);
  assert.match(reducedMotionBlock, /\.clockPanel::after,\s*\n\s*\.clockReadout::after\s*\{[\s\S]*animation:\s*none;/);
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

function assertLiveDjDesktopContract(css) {
  const panel = finalDesktopDeclarations(css, ".liveDjPanel");
  const text = finalDesktopDeclarations(css, ".liveDjText");
  const controls = finalDesktopDeclarations(css, ".talkControls");

  assert.equal(panel.height, "214px", "Live DJ panel height must stay fixed");
  assert.equal(panel["min-height"], "214px", "Live DJ panel min-height must stay fixed");
  assert.equal(panel.flex, "0 0 214px", "Live DJ panel flex-basis must stay fixed");
  assert.equal(panel["grid-template-rows"], "minmax(0, 1fr) auto", "Live DJ panel must reserve a stable controls row");

  assert.equal(text["font-size"], "16px", "Live DJ text font size must stay body-sized");
  assert.equal(text["line-height"], "1.62", "Live DJ text line-height must stay predictable");
  assert.equal(text.display, "-webkit-box", "Live DJ text must use line clamping");
  assert.equal(text["-webkit-line-clamp"], "3", "Live DJ text must clamp to three lines");
  assert.equal(text["-webkit-box-orient"], "vertical", "Live DJ text clamp orientation must stay vertical");
  assert.equal(text["max-height"], "calc(1.62em * 3)", "Live DJ text max height must match three lines");
  assert.equal(text.overflow, "hidden", "Live DJ text overflow must be hidden");

  assert.equal(controls["margin-top"], "18px", "Live DJ controls spacing must stay stable");
}

function finalDesktopDeclarations(css, selector) {
  const declarations = {};
  const source = desktopCss(css);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+");
  const rulePattern = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, "g");
  for (const match of source.matchAll(rulePattern)) {
    Object.assign(declarations, parseDeclarations(match[1]));
  }
  assert.ok(Object.keys(declarations).length, `missing desktop declarations for ${selector}`);
  return declarations;
}

function desktopCss(css) {
  const responsiveStart = css.search(/\n@media \(max-width:/);
  return responsiveStart === -1 ? css : css.slice(0, responsiveStart);
}

function parseDeclarations(block) {
  return block.split("\n").reduce((result, line) => {
    const trimmed = line.trim();
    const separator = trimmed.indexOf(":");
    if (separator === -1) return result;
    const property = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/;$/, "");
    if (property && value) result[property] = value;
    return result;
  }, {});
}
