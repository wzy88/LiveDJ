import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadGraph } from "./recommender.js";

test("loadGraph can read the bundled gzipped song graph", () => {
  const gzPath = path.resolve("data/song-graph.json.gz");
  assert.ok(fs.existsSync(gzPath), "expected data/song-graph.json.gz in workspace");

  const graph = loadGraph();

  assert.ok(graph.songs.length > 0);
  assert.ok(graph.byId instanceof Map);
});
