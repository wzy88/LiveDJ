import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export async function proxyAudioRequest({ target = "", range = "", res, fetchImpl = fetch } = {}) {
  let parsed;
  try {
    parsed = new URL(String(target || ""));
  } catch {
    res.status(400).send("bad audio url");
    return;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    res.status(400).send("bad audio url");
    return;
  }

  const headers = {};
  if (range) headers.Range = range;

  try {
    const upstream = await fetchImpl(parsed, { headers });
    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status).send("audio upstream failed");
      return;
    }

    res.status(upstream.status);
    copyAudioHeaders(upstream.headers, res);
    if (!res.getHeader("content-type")) {
      res.setHeader("content-type", "audio/mpeg");
    }
    res.setHeader("cache-control", "no-store");

    if (!upstream.body) {
      res.end();
      return;
    }

    const readable = Readable.fromWeb(upstream.body);
    readable.on("error", () => {});
    await pipeline(readable, res);
  } catch (error) {
    handleProxyError(error, res);
  }
}

function copyAudioHeaders(headers, res) {
  for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = typeof headers.get === "function" ? headers.get(header) : headers.get?.(header) || headers[header];
    if (value) res.setHeader(header, value);
  }
}

function handleProxyError(error, res) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) {
    res.destroy(new Error(`audio upstream terminated: ${error?.message || "unknown"}`));
    return;
  }
  res.status(502).send("audio proxy failed");
}
