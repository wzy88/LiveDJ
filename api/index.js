import app, { bootstrapRuntimeData } from "../server/index.js";

let bootstrapPromise = null;

export function restoreApiRequestUrl(req) {
  const requestUrl = new URL(req.url || "/", "https://vercel.local");
  const rewrittenPath = requestUrl.searchParams.get("__path");

  if (rewrittenPath !== null) {
    requestUrl.searchParams.delete("__path");
    const path = rewrittenPath.replace(/^\/+|\/+$/g, "");
    const query = requestUrl.searchParams.toString();
    req.url = `/api${path ? `/${path}` : ""}${query ? `?${query}` : ""}`;
  } else if (!String(req.url || "").startsWith("/api/")) {
    req.url = `/api${req.url || "/"}`;
  }

  return req.url;
}

export default async function handler(req, res) {
  bootstrapPromise ||= bootstrapRuntimeData().catch((error) => {
    console.warn(`Vercel runtime bootstrap failed: ${error.message}`);
  });
  await bootstrapPromise;

  restoreApiRequestUrl(req);
  return app(req, res);
}
