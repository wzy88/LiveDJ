# Claudio Radio Web

Web radio prototype with a Vite/React frontend and an Express backend for recommendation, TTS, audio proxying, and radio program generation.

## Local Development

```bash
npm install
npm run build
npm run dev
```

The local frontend uses `http://127.0.0.1:8787` as its API base in development.

## Vercel Frontend

Vercel can deploy the frontend from this repository:

- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: `VITE_API_BASE=https://your-backend-domain`

Use `VITE_API_BASE` when the backend is deployed separately. Without it, the production frontend calls same-origin `/api`.

## Backend

The backend is a long-running Node service:

```bash
npm start
```

It serves both `/api/*` and the built `dist/` frontend when `dist` exists.

Recommended backend targets: Cloud Run, Render, Railway, Fly.io, or a VPS. Vercel Serverless is not ideal for this backend because the runtime depends on a large local song graph, TTS generation, and audio proxy streaming.

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
