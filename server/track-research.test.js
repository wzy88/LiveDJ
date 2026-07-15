import assert from "node:assert/strict";
import test from "node:test";

import { parseBingSearchResults, summarizeTrackResearch } from "./track-research.js";

test("track research turns search snippets into compact DJ material", () => {
  const research = summarizeTrackResearch({
    track: {
      title: "一半一半",
      artist: "Top Barry / INDEcompany",
      genres: [{ value: "R&B" }, { value: "流行" }],
      moods: [{ value: "松弛" }]
    },
    items: [
      {
        title: "一半一半 - 歌曲资料",
        snippet: "这首歌带有 R&B 低频和贴近耳边的人声，节奏不急，适合夜里独处时听。"
      },
      {
        title: "听众讨论",
        snippet: "很多人说它像桌前工作时的背景声，不抢注意力，但能把情绪慢慢放轻。"
      },
      {
        title: "无关结果",
        snippet: "在线试听 下载 铃声 MP3 无损 网盘"
      }
    ]
  });

  assert.equal(research.provider, "search-summary");
  assert.match(research.audibleCues.join(" "), /R&B低频|人声贴近|节奏不急/);
  assert.match(research.listenerAngles.join(" "), /桌前|不抢注意力|放轻/);
  assert.ok(research.talkSeeds.some((seed) => /低频|人声|桌前|背景/.test(seed)));
  assert.doesNotMatch(JSON.stringify(research), /下载|铃声|网盘/);
});

test("Bing search parser extracts title snippet and url from result html", () => {
  const html = `
    <li class="b_algo">
      <h2><a href="https://music.163.com/song?id=1">一半一半 - Top Barry - 网易云音乐</a></h2>
      <div class="b_caption"><p class="b_lineclamp2">歌曲有 R&B 低频和贴近的人声，评论里常说适合夜里桌前听。</p></div>
    </li>
    <li class="b_algo">
      <h2><a href="https://spam.example.com">下载 铃声 MP3</a></h2>
      <div class="b_caption"><p>免费下载无损网盘。</p></div>
    </li>
  `;

  const results = parseBingSearchResults(html, {
    title: "一半一半",
    artist: "Top Barry / INDEcompany"
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].title, "一半一半 - Top Barry - 网易云音乐");
  assert.match(results[0].snippet, /R&B 低频|桌前/);
  assert.equal(results[0].url, "https://music.163.com/song?id=1");
});

test("Bing search parser rejects generic travel pages for song-like common titles", () => {
  const html = `
    <li class="b_algo">
      <h2><a href="https://travel.example.com/dali">旅行的意义：云南小城路线攻略</a></h2>
      <div class="b_caption"><p>这篇攻略讨论旅行的意义、目的地、酒店和骑行路线，适合假期出发前参考。</p></div>
    </li>
  `;

  const results = parseBingSearchResults(html, {
    title: "旅行的意义",
    artist: "陈绮贞"
  });

  assert.equal(results.length, 0);
});

test("Bing search parser rejects same-title material when the artist does not match", () => {
  const html = `
    <li class="b_algo">
      <h2><a href="https://music.example.com/xue">一半一半 歌词解析</a></h2>
      <div class="b_caption"><p>这里整理一半一半相关讨论和听众感受，页面主体讲的是另一位歌手的作品。</p></div>
    </li>
  `;

  const results = parseBingSearchResults(html, {
    title: "一半一半",
    artist: "Top Barry / INDEcompany"
  });

  assert.equal(results.length, 0);
});

test("Bing search parser rejects lyric mirror pages as DJ research material", () => {
  const html = `
    <li class="b_algo">
      <h2><a href="https://lyrics.example.com/song">旅行的意义 歌词 - 陈绮贞</a></h2>
      <div class="b_caption"><p>作词：陈绮贞 作曲：陈绮贞 这里搬运完整歌词文本和逐句内容。</p></div>
    </li>
  `;

  const results = parseBingSearchResults(html, {
    title: "旅行的意义",
    artist: "陈绮贞"
  });

  assert.equal(results.length, 0);
});
