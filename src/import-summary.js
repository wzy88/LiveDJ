export function getImportCounts(result = {}, extractedCount = 0) {
  const currentCount = Number(extractedCount || result.source?.extractedCount || 0);
  const totalImported = Number(result.importedCount || 0);
  const totalMatched = Number(result.matchedCount || 0);
  const totalResolved = Number(result.resolvedCount || 0);
  const unmatchedTotal = Math.max(0, totalImported - totalMatched);

  return {
    currentCount,
    totalImported,
    totalMatched,
    totalResolved,
    unmatchedTotal
  };
}

export function buildImportSummary(result = {}, extractedCount = 0) {
  const counts = getImportCounts(result, extractedCount);
  const currentText = counts.currentCount
    ? `这次读到了 ${counts.currentCount} 首。`
    : "我已经读到了这次导入的内容。";
  const libraryText = counts.totalImported
    ? `你的口味库现在累计 ${counts.totalImported} 首，图谱已匹配 ${counts.totalMatched} 首。`
    : `图谱已匹配 ${counts.totalMatched} 首。`;
  const playableText = counts.totalResolved ? `其中 ${counts.totalResolved} 首确认可播。` : "";
  const unmatchedText = counts.unmatchedTotal ? `还有 ${counts.unmatchedTotal} 首暂时没匹配上，我会用相近口味补队列。` : "";

  return `${currentText}${libraryText}${playableText}${unmatchedText}我已经记入口味，当前播放不打断；你下次换歌或重排时我会优先参考它。`;
}

export function buildImportStatus(result = {}, extractedCount = 0) {
  const counts = getImportCounts(result, extractedCount);
  const currentText = counts.currentCount ? `本次读取 ${counts.currentCount} 首` : "本次导入已读取";
  const libraryText = counts.totalImported
    ? `口味库累计 ${counts.totalImported} 首，已匹配 ${counts.totalMatched} 首`
    : `已匹配 ${counts.totalMatched} 首`;
  return `${currentText}；${libraryText}；当前播放不会被打断。`;
}
