import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let musicApi = null;

export async function tracksFromPlaylistUrl(sourceUrl) {
  const id = extractNeteasePlaylistId(sourceUrl);
  if (!id) {
    throw new Error("暂时只支持网易云歌单链接，请粘贴包含 playlist?id= 的链接。");
  }
  const api = getMusicApi();
  if (!api?.playlist_track_all && !api?.playlist_detail) {
    throw new Error("歌单解析服务不可用。");
  }
  const detail = api.playlist_track_all
    ? await api.playlist_track_all({ id, limit: "120" })
    : await api.playlist_detail({ id });
  const songs = detail?.body?.songs || detail?.body?.playlist?.tracks || [];
  const tracks = songs.map((song) => ({
    title: cleanText(song.name),
    artist: cleanText((song.ar || song.artists || []).map((artist) => artist.name).filter(Boolean).join(" / "))
  })).filter((track) => track.title && track.artist);
  if (!tracks.length) {
    throw new Error("没有从这个链接里解析到歌曲，可能是私密歌单或链接格式不支持。");
  }
  return {
    provider: "netease",
    playlistId: id,
    tracks
  };
}

function extractNeteasePlaylistId(value = "") {
  const text = String(value).trim();
  if (!text) return "";
  const direct = text.match(/(?:playlist\?id=|playlist\/)(\d{5,})/i);
  if (direct) return direct[1];
  try {
    const parsed = new URL(text);
    return parsed.searchParams.get("id") || "";
  } catch {
    return "";
  }
}

function getMusicApi() {
  if (musicApi !== null) return musicApi;
  try {
    musicApi = require("NeteaseCloudMusicApi");
  } catch {
    musicApi = false;
  }
  return musicApi || null;
}

function cleanText(value = "") {
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}
