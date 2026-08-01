import app, { bootstrapRuntimeData } from "../server/index.js";

let bootstrapPromise = null;

export default async function handler(req, res) {
  bootstrapPromise ||= bootstrapRuntimeData().catch((error) => {
    console.warn(`Vercel runtime bootstrap failed: ${error.message}`);
  });
  await bootstrapPromise;

  if (!String(req.url || "").startsWith("/api/")) {
    req.url = `/api${req.url || "/"}`;
  }

  return app(req, res);
}
