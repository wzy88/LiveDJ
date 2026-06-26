import assert from "node:assert/strict";
import test from "node:test";

import { summarizeArtistContext } from "./artist-context.js";

test("artist context summarizes NetEase artist detail into talk-ready facts", () => {
  const context = summarizeArtistContext({
    track: { artist: "陈绮贞" },
    detail: {
      data: {
        artist: {
          name: "陈绮贞",
          briefDesc: "台湾创作女歌手，以清澈嗓音和民谣气质受到关注。"
        }
      }
    },
    description: {
      introduction: [
        {
          ti: "从艺历程",
          txt: "她早期以独立创作和校园民谣气质被听众认识，作品常与旅行、城市和私人记忆有关。"
        }
      ]
    }
  });

  assert.equal(context.provider, "netease-artist");
  assert.equal(context.name, "陈绮贞");
  assert.match(context.brief, /清澈嗓音|民谣气质/);
  assert.ok(context.facts.some((item) => /校园民谣|旅行|私人记忆/.test(item)));
});

test("artist context returns empty context when data is missing", () => {
  const context = summarizeArtistContext({ track: { artist: "" } });

  assert.deepEqual(context, {
    provider: "",
    name: "",
    brief: "",
    facts: []
  });
});
