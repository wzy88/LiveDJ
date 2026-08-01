# Claudio Radio Web

Web radio prototype with a Vite/React frontend and an Express backend for recommendation, TTS, audio proxying, and radio program generation.

## Local Development

```bash
npm install
npm run build
npm run dev
```

Open the local frontend at `http://127.0.0.1:5174`. It uses
`http://127.0.0.1:8787` as its API base in development.

## Vercel Frontend

Vercel can deploy the frontend and the `/api/*` Express backend from this
repository:

- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: leave `VITE_API_BASE` unset for same-origin `/api`

Use `VITE_API_BASE` only when the backend is deployed separately. Without it,
the production frontend calls same-origin `/api`, which is handled by
`api/[...path].js` on Vercel.

## Backend

The backend is a long-running Node service:

```bash
npm start
```

### Vercel Hobby

The committed `api/index.js` imports the Express app as a Vercel Function.
The service reads the committed `data/song-graph.json.gz`, so no separate graph
upload is required for the current lite graph.

After Vercel deploys `main`, verify:

```bash
curl https://claudio-radio-web.vercel.app/api/health
curl https://claudio-radio-web.vercel.app/api/graph/stats
```

Vercel Functions do not provide persistent project storage. Imported playlists,
feedback, playable-source cache, and in-app LLM config can survive within a warm
function instance, but can be lost after a cold start until real user storage is
added.

It serves both `/api/*` and the built `dist/` frontend when `dist` exists.

For a larger graph, long-lived user memory, or heavy audio proxy traffic, move
the backend to Cloud Run, Fly.io, Render, Railway, or a VPS with persistent
storage and bandwidth controls.

Required local data files are intentionally not committed:

- `data/song-graph.json`
- `data/playable-index.json`
- `data/user-profile.json`

For deployed backends, upload `data/song-graph.json` or `data/song-graph.json.gz` to object storage and set:

```bash
SONG_GRAPH_URL=https://your-object-storage/song-graph.json
```

The server downloads it on startup when the local file is missing.

Set `PUBLIC_ORIGIN` on the backend to the deployed frontend origin, for example:

```bash
PUBLIC_ORIGIN=https://radio.example.com
```

Playable music is resolved at runtime. By default the backend uses the bundled
`NeteaseCloudMusicApi` package internally, so a single Railway service is enough
for the MVP. If you deploy a separate music API, set `MUSIC_API_BASE` to that
service URL.

Optional LLM DJ talk generation:

```bash
LLM_API_KEY=your-model-api-key
LLM_MODEL=your-chat-model
LLM_VISION_MODEL=your-vision-model
LLM_API_BASE=https://api.openai.com/v1
```

DeepSeek can be configured directly:

```bash
DEEPSEEK_API_KEY=your-deepseek-api-key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_API_BASE=https://api.deepseek.com
```

The backend automatically loads `.env` and `.env.local` in development.

When these are not configured, the backend falls back to Claudio's rule-based
talk script generator. Screenshot playlist import needs a vision-capable model;
playlist links do not.
