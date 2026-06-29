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

test("artist context drops spammy social contact facts from NetEase descriptions", () => {
  const context = summarizeArtistContext({
    track: { artist: "Top Barry / INDEcompany" },
    detail: {
      data: {
        artist: {
          name: "Top Barry",
          briefDesc: "群加:vx: whxcya0506(非本人) 在珠海的兰州人"
        }
      }
    },
    description: {
      introduction: [
        { txt: "群加:vx: whxcya0506(非本人) 在珠海的兰州人" },
        { txt: "作品里常有 R&B、城市夜晚和旋律说唱的气质。" }
      ]
    }
  });

  assert.equal(context.brief, "");
  assert.doesNotMatch(context.facts.join(" "), /群加|vx|非本人|whxcya/);
  assert.ok(context.facts.some((item) => /R&B|城市夜晚|旋律说唱/.test(item)));
});
