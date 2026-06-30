export function buildDefaultRadioQuery(now = new Date()) {
  const hour = getLocalHour(now);
  if (hour >= 5 && hour < 9) return "早上通勤，想听一点华语、清醒、但不要太吵";
  if (hour >= 9 && hour < 12) return "上午工作间隙，想听一点华语、清爽、但不要太吵";
  if (hour >= 12 && hour < 14) return "午间休息，想听一点华语、松弛、但不要太丧";
  if (hour >= 14 && hour < 18) return "下午工作间隙，想听一点华语、提神、但不要太躁";
  if (hour >= 18 && hour < 23) return "晚上回家路上，想听一点华语、松弛、但不要太丧";
  return "深夜放松，想听一点华语、安静、但不要太沉";
}

function getLocalHour(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hour12: false
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || now.getHours());
  return Number.isFinite(hour) ? hour : now.getHours();
}
