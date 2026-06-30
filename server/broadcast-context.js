export function buildBroadcastContext({ now = new Date(), weatherSummary = "", newsSummary = "", city = "", editorialMode = "" } = {}) {
  const context = {
    timeCue: buildTimeCue(now),
    weatherSummary: cleanSummary(weatherSummary || process.env.RADIO_WEATHER_SUMMARY || ""),
    newsSummary: cleanSummary(newsSummary || process.env.RADIO_NEWS_SUMMARY || "")
  };
  const cleanCity = cleanSummary(city || process.env.RADIO_CITY || "");
  const cleanMode = cleanSummary(editorialMode || process.env.RADIO_EDITORIAL_MODE || "");
  if (cleanCity && cleanMode === "test") {
    return {
      ...context,
      ...buildTestEditorialContext({ city: cleanCity, timeCue: context.timeCue, now })
    };
  }
  return context;
}

export async function fetchBeijingBroadcastContext({
  now = new Date(),
  city = "北京",
  editorialMode = "test",
  currentsApiKey = process.env.CURRENTS_API_KEY || process.env.NEWS_API_KEY || "",
  timeoutMs = 1800
} = {}) {
  const base = buildBroadcastContext({ now, city, editorialMode });
  const [weatherSummary, liveNewsBriefs] = await Promise.all([
    fetchOpenMeteoWeatherSummary({ city, timeoutMs }).catch(() => ""),
    fetchCurrentsNewsBriefs({ apiKey: currentsApiKey, city, timeoutMs }).catch(() => [])
  ]);
  const newsBriefs = [
    ...liveNewsBriefs,
    ...(base.newsBriefs || [])
  ].slice(0, 5);
  return {
    ...base,
    weatherSummary: weatherSummary || base.weatherSummary || "",
    newsSummary: liveNewsBriefs[0]?.text || base.newsSummary || "",
    newsBriefs
  };
}

export async function fetchOpenMeteoWeatherSummary({ city = "北京", timeoutMs = 1600 } = {}) {
  const coordinates = getCityCoordinates(city);
  if (!coordinates) return "";
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(coordinates.latitude));
  url.searchParams.set("longitude", String(coordinates.longitude));
  url.searchParams.set("current", "temperature_2m,precipitation,weather_code,wind_speed_10m");
  url.searchParams.set("timezone", "Asia/Shanghai");
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
  if (!response?.ok) return "";
  const data = await response.json().catch(() => null);
  const current = data?.current || {};
  const units = data?.current_units || {};
  const temperature = Number(current.temperature_2m);
  const precipitation = Number(current.precipitation);
  const wind = Number(current.wind_speed_10m);
  const weather = weatherCodeToText(current.weather_code, precipitation);
  const parts = [];
  if (Number.isFinite(temperature)) parts.push(`${Math.round(temperature)}${units.temperature_2m || "°C"}`);
  if (weather) parts.push(weather);
  if (Number.isFinite(wind)) parts.push(`风速约 ${Math.round(wind)}${units.wind_speed_10m || "km/h"}`);
  if (!parts.length) return "";
  return cleanSummary(`${coordinates.name}现在 ${parts.join("，")}`);
}

export async function fetchCurrentsNewsBriefs({ apiKey = "", city = "北京", timeoutMs = 1800 } = {}) {
  const cleanKey = String(apiKey || "").trim();
  if (!cleanKey) return [];
  const url = new URL("https://api.currentsapi.services/v1/search");
  url.searchParams.set("keywords", city === "北京" ? "Beijing OR 北京 OR AI OR music OR culture" : city);
  url.searchParams.set("language", "zh");
  url.searchParams.set("page_size", "5");
  const response = await fetch(url, {
    headers: { Authorization: cleanKey },
    signal: AbortSignal.timeout(timeoutMs)
  }).catch(() => null);
  if (!response?.ok) return [];
  const data = await response.json().catch(() => null);
  return (data?.news || [])
    .map((item) => makeBriefFromNews(item, "currents"))
    .filter(Boolean)
    .slice(0, 3);
}

function buildTimeCue(now) {
  const hour = getLocalHour(now);
  if (hour >= 5 && hour < 9) return "早上";
  if (hour >= 9 && hour < 12) return "上午";
  if (hour >= 12 && hour < 14) return "中午";
  if (hour >= 14 && hour < 18) return "下午";
  if (hour >= 18 && hour < 23) return "今晚";
  return "深夜";
}

function getCityCoordinates(city = "") {
  const cleanCity = cleanSummary(city || "北京");
  if (!cleanCity || cleanCity === "北京") {
    return { name: "北京", latitude: 39.9042, longitude: 116.4074 };
  }
  return null;
}

function weatherCodeToText(code, precipitation = 0) {
  const numericCode = Number(code);
  if (Number.isFinite(precipitation) && precipitation > 0.1) {
    if (numericCode >= 80) return "阵雨";
    return "小雨";
  }
  if ([0].includes(numericCode)) return "晴";
  if ([1, 2].includes(numericCode)) return "少云";
  if ([3].includes(numericCode)) return "多云";
  if ([45, 48].includes(numericCode)) return "有雾";
  if (numericCode >= 51 && numericCode <= 67) return "小雨";
  if (numericCode >= 71 && numericCode <= 77) return "有雪";
  if (numericCode >= 80 && numericCode <= 82) return "阵雨";
  if (numericCode >= 95) return "雷雨";
  return "天气平稳";
}

function makeBriefFromNews(item = {}, source = "news") {
  const title = cleanSummary(item.title || "");
  const description = cleanSummary(item.description || "");
  const text = cleanSummary([title, description].filter(Boolean).join("："));
  if (!text) return null;
  return {
    text,
    source
  };
}

function getLocalHour(now) {
  const timeZone = process.env.RADIO_TIME_ZONE || "Asia/Shanghai";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || now.getHours());
  return Number.isFinite(hour) ? hour : now.getHours();
}

function cleanSummary(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 90);
}

function buildTestEditorialContext({ city, timeCue, now }) {
  const daypart = resolveDaypart(now);
  if (city !== "北京") {
    return {
      city,
      ...buildGenericCityEditorial({ city, timeCue, daypart })
    };
  }

  const timed = buildBeijingEditorialByDaypart(daypart);
  return {
    city: "北京",
    localSceneSummary: buildBeijingScene(timeCue, now),
    newsBriefs: timed.newsBriefs.map(makeBrief),
    cultureBriefs: timed.cultureBriefs.map(makeBrief),
    editorialAngles: timed.editorialAngles
  };
}

function resolveDaypart(now) {
  const hour = getLocalHour(now);
  if (hour >= 5 && hour < 9) return "morning";
  if (hour >= 9 && hour < 12) return "forenoon";
  if (hour >= 12 && hour < 14) return "noon";
  if (hour >= 14 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "late-night";
}

function buildGenericCityEditorial({ city, timeCue, daypart }) {
  if (daypart === "evening" || daypart === "late-night") {
    return {
      localSceneSummary: `${city}${timeCue || "这会儿"}的城市节奏适合放慢一点，灯光和耳机里的歌可以先把人从白天接出来。`,
      newsBriefs: [
        makeBrief(`${city}这几天被反复讨论的是街区更新、演出和夜间消费，放进电台里只取和歌曲有关的一点`),
        makeBrief(`很多城市都在谈文旅、演出和周末消费，放进电台里，可以具体落到散场后的路口`)
      ],
      cultureBriefs: [
        makeBrief(`演出、展览和小型现场让${city}的夜晚多了一点亮色，很多故事发生在散场和等车的时候`)
      ],
      editorialAngles: [`${city}夜里的路口`, "散场后的路灯和便利店", "资讯很多但只取和歌曲有关的一点"]
    };
  }
  return {
    localSceneSummary: `${city}${timeCue || "这会儿"}的城市节奏还在工作日的中段，咖啡、消息和会议间隙可以给歌一个具体位置。`,
    newsBriefs: [
      makeBrief(`${city}这几天被反复讨论的是街区更新、办公效率和日常消费，放进电台里只取和歌曲有关的一点`),
      makeBrief(`工作日白天的信息很多，适合把新闻压低成背景，只留给音乐一个清楚入口`)
    ],
    cultureBriefs: [
      makeBrief(`展览、书店和小型现场也会改变白天的城市路线，但这里不做资讯播报，只拿来给歌曲找画面`)
    ],
    editorialAngles: [`${city}上午的写字楼和街口`, "咖啡和会议间隙", "资讯很多但只取和歌曲有关的一点"]
  };
}

function buildBeijingEditorialByDaypart(daypart) {
  if (daypart === "morning") {
    return {
      newsBriefs: [
        "早高峰、办公效率和日常消费仍然是北京工作日的底色，放进电台里只取一个对照：人需要一点不催促的声音",
        "科技产品、AI 应用和效率工具总在提醒人快一点，放进歌里，可以只取一个对照：人需要几分钟不看屏幕",
        "通勤和当天计划经常挤在同一张时间表里，歌可以先放在进办公室前后的几分钟"
      ],
      cultureBriefs: [
        "展览、书店和小型现场也会改变北京的日常路线，上午只先把这些当作城市背景，不急着展开",
        "咖啡店、地铁口和写字楼前的人流给歌一个具体位置：杯盖、消息提示和还没完全醒来的耳朵"
      ],
      editorialAngles: ["北京早高峰后的写字楼", "咖啡和会议间隙", "AI 和效率话题背后的屏幕疲劳", "上午耳机里的几分钟"]
    };
  }
  if (daypart === "forenoon" || daypart === "noon") {
    return {
      newsBriefs: [
        "办公效率、AI 应用和城市日常消费还在被讨论，落到电台里，可以说到会议间隙和耳机里的几分钟",
        "北京工作日中段的信息很多，歌不用追热点，只需要把注意力从屏幕旁边带回来一点",
        "咖啡、外卖和当天计划挤在一起，放进节目里，可以变成一段不打扰人的白天背景"
      ],
      cultureBriefs: [
        "展览、书店和小型现场把北京的白天也抬亮一点，很多故事不在热搜里，而在午间和会议间隙",
        "写字楼、咖啡店和地铁口给歌一个具体位置：屏幕、杯盖、外卖骑手和短暂空下来的耳朵"
      ],
      editorialAngles: ["北京上午的写字楼和咖啡", "会议间隙和耳机里的几分钟", "AI 和效率话题背后的屏幕疲劳", "白天信息流旁边的一首歌"]
    };
  }
  if (daypart === "afternoon") {
    return {
      newsBriefs: [
        "城市更新、办公效率和周末计划经常挤在北京下午的时间表里，歌可以先给人一个出口",
        "科技产品、AI 应用和效率工具总在提醒人快一点，放进歌里，可以只取一个对照：人需要几分钟不看屏幕",
        "下午的信息流很满，电台里不用追完，只需要把和歌曲有关的一点留下"
      ],
      cultureBriefs: [
        "展览、Livehouse和小剧场把接近傍晚的北京抬亮一点，但这里先不写成夜晚，只当作后半天的期待",
        "胡同口、商场外摆和写字楼玻璃会给歌一个具体位置：风、招牌和还没结束的白天"
      ],
      editorialAngles: ["北京下午的写字楼玻璃", "后半天的任务和耳机", "AI 和效率话题背后的屏幕疲劳", "快到傍晚但还没下班的出口"]
    };
  }
  return {
    newsBriefs: [
      "城市更新和夜间消费的话题这两天还在被讨论，落到电台里，可以说到下班后从写字楼到地铁口那段路",
      "科技产品、AI 应用和效率工具总在提醒人快一点，放进歌里，可以只取一个对照：人需要几分钟不看屏幕",
      "通勤、加班和周末计划经常被放在同一张时间表里，北京的日常很满，歌可以先放在回家路上那十几分钟"
    ],
    cultureBriefs: [
      "Livehouse、展览和小剧场把周中的北京抬亮一点，很多人的故事不在热搜里，而在散场后的地铁口",
      "胡同口、商场外摆和深夜便利店会给歌一个具体位置：路灯、风、外卖骑手和还亮着的招牌"
    ],
    editorialAngles: ["北京下班后的地铁口", "散场后的路灯和便利店", "AI 和效率话题背后的屏幕疲劳", "热闹外面的一段回家路"]
  };
}

function buildBeijingScene(timeCue, now) {
  const hour = getLocalHour(now);
  if (hour >= 5 && hour < 10) {
    return "北京早高峰刚把人推上地铁和环路，写字楼的灯一层层亮起来，耳机里需要一点不催人的声音。";
  }
  if (hour >= 9 && hour < 12) {
    return "北京上午的写字楼和咖啡还在工作日的中段，消息、会议和外卖提醒挤在一起，适合把耳朵从工作语气里拿出来。";
  }
  if (hour >= 12 && hour < 14) {
    return "北京中午的街面短暂松一下，咖啡、外卖和午休间隙挤在一起，适合把耳朵从工作语气里拿出来。";
  }
  if (hour >= 14 && hour < 18) {
    return "北京下午的光落在写字楼玻璃和胡同墙面上，人还在处理任务，心已经开始等一个能下班的出口。";
  }
  if (hour >= 18 && hour < 23) {
    return "北京今晚的通勤尾声还挂在地铁和环路上，写字楼的灯慢慢暗下去，胡同口的夜风开始有一点松。";
  }
  return "北京深夜安静得更明显，环路车流低下去，便利店和路灯还醒着，适合把没说完的话先放进歌里。";
}

function makeBrief(text) {
  return {
    text: cleanSummary(text),
    source: "test-editorial"
  };
}
