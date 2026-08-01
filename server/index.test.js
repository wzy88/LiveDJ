import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const indexSource = readFileSync(new URL("./index.js", import.meta.url), "utf8");

test("dialogue endpoint enriches companion chat with broadcast context", () => {
  assert.match(indexSource, /import \{ fetchBeijingBroadcastContext \} from "\.\/broadcast-context\.js";/);
  const dialogueBlock = indexSource.match(/app\.post\("\/api\/dialogue"[\s\S]*?\n\}\);/)?.[0] || "";
  assert.ok(dialogueBlock, "dialogue endpoint should exist");
  assert.match(dialogueBlock, /const broadcastContext = await fetchBeijingBroadcastContext/);
  assert.match(dialogueBlock, /broadcastContext/);
  assert.match(dialogueBlock, /generateDialogueReplyWithLlm\(\{/);
});

test("runtime treats the committed gzip song graph as available", () => {
  assert.match(indexSource, /const graphGzipPath = `\$\{graphPath\}\.gz`;/);
  assert.match(indexSource, /fs\.existsSync\(graphPath\) \|\| fs\.existsSync\(graphGzipPath\)/);
  assert.match(indexSource, /if \(!fs\.existsSync\(graphPath\) && !fs\.existsSync\(graphGzipPath\)\) return;/);
});
