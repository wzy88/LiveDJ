import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBroadcastContext,
  fetchBeijingBroadcastContext,
  fetchCurrentsNewsBriefs,
  fetchOpenMeteoWeatherSummary
} from "./broadcast-context.js";

test("broadcast context includes local time cue without inventing weather or news", () => {
  const context = buildBroadcastContext({
    now: new Date("2026-06-18T12:30:00+08:00")
  });

  assert.equal(context.timeCue, "中午");
  assert.equal(context.weatherSummary, "");
  assert.equal(context.newsSummary, "");
});

test("broadcast context uses provided weather and news summaries", () => {
  const context = buildBroadcastContext({
    now: new Date("2026-06-18T21:00:00+08:00"),
    weatherSummary: "外面有点潮，适合慢一点听",
    newsSummary: "今天科技圈最热的是 AI 应用更新"
  });

  assert.deepEqual(context, {
    timeCue: "今晚",
    weatherSummary: "外面有点潮，适合慢一点听",
    newsSummary: "今天科技圈最热的是 AI 应用更新"
  });
});

test("broadcast context can provide Beijing editorial material for test-stage scripts", () => {
  const context = buildBroadcastContext({
    now: new Date("2026-06-18T21:00:00+08:00"),
    city: "北京",
    editorialMode: "test"
  });

  assert.equal(context.timeCue, "今晚");
  assert.equal(context.city, "北京");
  assert.match(context.localSceneSummary, /北京|地铁|环路|写字楼|胡同|夜风/);
  assert.ok(context.newsBriefs.length >= 2);
  assert.ok(context.cultureBriefs.length >= 1);
  assert.ok(context.editorialAngles.length >= 2);
  assert.ok(context.newsBriefs.every((item) => item.source === "test-editorial"));
  assert.doesNotMatch(context.newsBriefs.map((item) => item.text).join("\n"), /突发|刚刚|实时|独家/);
});

test("Beijing evening editorial material still uses evening commute copy", () => {
  const context = buildBroadcastContext({
    now: new Date("2026-06-30T21:06:00+08:00"),
    city: "北京",
    editorialMode: "test"
  });
  const joined = [
    context.timeCue,
    context.localSceneSummary,
    ...(context.newsBriefs || []).map((item) => item.text),
    ...(context.cultureBriefs || []).map((item) => item.text),
    ...(context.editorialAngles || [])
  ].join("\n");

  assert.equal(context.timeCue, "今晚");
  assert.match(joined, /下班|夜间消费|回家路|夜风|路灯/);
});

test("Beijing test editorial material respects morning and avoids evening commute copy", () => {
  const context = buildBroadcastContext({
    now: new Date("2026-06-30T10:06:00+08:00"),
    city: "北京",
    editorialMode: "test"
  });
  const joined = [
    context.timeCue,
    context.localSceneSummary,
    ...(context.newsBriefs || []).map((item) => item.text),
    ...(context.cultureBriefs || []).map((item) => item.text),
    ...(context.editorialAngles || [])
  ].join("\n");

  assert.equal(context.timeCue, "上午");
  assert.match(joined, /上午|会议|咖啡|外卖|工作|写字楼/);
  assert.doesNotMatch(joined, /今晚|下班|晚高峰|夜间消费|回家路|回家那十几分钟|夜风/);
});

test("open meteo weather summary turns Beijing weather data into a usable one-line cue", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /open-meteo\.com/);
    return {
      ok: true,
      json: async () => ({
        current: {
          temperature_2m: 29.4,
          precipitation: 0.2,
          weather_code: 61,
          wind_speed_10m: 9.6
        },
        current_units: {
          temperature_2m: "°C",
          wind_speed_10m: "km/h"
        }
      })
    };
  };

  try {
    const summary = await fetchOpenMeteoWeatherSummary({ city: "北京" });
    assert.match(summary, /北京|29|小雨|风/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("currents news provider converts keyed API results into source-tagged briefs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /currentsapi\.services/);
    assert.equal(options.headers.Authorization, "test-key");
    return {
      ok: true,
      json: async () => ({
        news: [
          {
            title: "北京周末演出市场持续升温",
            description: "多个 Livehouse 和剧场上新，年轻人把下班后的时间更多留给现场。"
          },
          {
            title: "AI 应用继续进入日常工具",
            description: "办公效率和内容生成相关产品仍然受到关注。"
          }
        ]
      })
    };
  };

  try {
    const briefs = await fetchCurrentsNewsBriefs({ apiKey: "test-key", city: "北京" });
    assert.equal(briefs.length, 2);
    assert.deepEqual(briefs.map((item) => item.source), ["currents", "currents"]);
    assert.match(briefs[0].text, /北京周末演出市场|Livehouse/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetch Beijing broadcast context enriches test editorial context with live weather and keyed news", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("open-meteo.com")) {
      return {
        ok: true,
        json: async () => ({
          current: {
            temperature_2m: 27,
            precipitation: 0,
            weather_code: 1,
            wind_speed_10m: 6
          },
          current_units: {
            temperature_2m: "°C",
            wind_speed_10m: "km/h"
          }
        })
      };
    }
    return {
      ok: true,
      json: async () => ({
        news: [{ title: "北京夜间消费场景更新", description: "商圈和演出空间带动下班后的城市动线。" }]
      })
    };
  };

  try {
    const context = await fetchBeijingBroadcastContext({
      now: new Date("2026-06-18T21:00:00+08:00"),
      currentsApiKey: "test-key"
    });
    assert.equal(context.city, "北京");
    assert.match(context.weatherSummary, /北京|27|少云|晴|风/);
    assert.ok(context.newsBriefs.some((item) => item.source === "currents"));
    assert.ok(context.newsBriefs.some((item) => item.source === "test-editorial"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
