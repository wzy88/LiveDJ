import assert from "node:assert/strict";
import test from "node:test";

import { buildImportStatus, buildImportSummary } from "./import-summary.js";

test("import summary separates current import count from cumulative profile counts", () => {
  const result = {
    source: { extractedCount: 67 },
    importedCount: 198,
    matchedCount: 147,
    resolvedCount: 1
  };

  const summary = buildImportSummary(result, result.source.extractedCount);
  const status = buildImportStatus(result, result.source.extractedCount);

  assert.match(summary, /这次读到了 67 首。/);
  assert.match(summary, /口味库现在累计 198 首，图谱已匹配 147 首。/);
  assert.match(status, /本次读取 67 首；口味库累计 198 首，已匹配 147 首/);
  assert.doesNotMatch(summary, /读到了 67 首，图谱匹配到 147 首/);
  assert.doesNotMatch(status, /导入 67 首，图谱匹配 147 首/);
});

test("import summary handles an empty current import without inventing a same-batch match rate", () => {
  const summary = buildImportSummary({ importedCount: 120, matchedCount: 80, resolvedCount: 0 }, 0);

  assert.match(summary, /已经读到了这次导入的内容。/);
  assert.match(summary, /口味库现在累计 120 首，图谱已匹配 80 首。/);
  assert.doesNotMatch(summary, /这次读到了 0 首/);
});
