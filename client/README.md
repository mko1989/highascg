# HighAsCG client — operator UI (canonical)

Static **HTML / CSS / ES modules** — the operator UI served on the playout machine at **`http://<host>:4200/`**.

**This folder is the source of truth** for the operator UI. It lives in the **main highascg repo** alongside the server (`src/`). Build with Vite into **`dist-web/`** at the repo root; Node serves that bundle in production.

| Entry / area | Path |
|--------------|------|
| Document shell | `index.html` |
| App bootstrap | `app.js` |
| API origin | `lib/api-origin.js` |
| API + WebSocket clients | `lib/api-client.js`, `lib/ws-client.js` |
| Global styles | `styles.css`, `styles/*.css` |
| Components | `components/*.js` |
| Assets | `assets/`, `fonts/` |
| Electron hub (packaging only) | `tools/electron-launcher/` → [**highascg-client**](https://github.com/mko1989/highascg-client) |

## Production (playout machine)

```bash
# From repo root
npm run build:client    # client/ → dist-web/
npm start               # serves dist-web/ + API on :4200
```

Open **`http://<playout-ip>:4200/`**. After UI changes: rebuild, then refresh the browser (server sends `no-cache` on HTML/JS/CSS).

## Split dev (faster UI iteration)

API and Vite dev server use different ports on the same or another machine:

```bash
# Terminal 1 — API (playout host)
npm start

# Terminal 2 — UI with HMR (:4350 → API via VITE_HIGHASCG_API_ORIGIN)
npm run dev:client
```

Open **http://localhost:4350/**. Copy `.env.development.example` → `.env.development`; set `VITE_HIGHASCG_API_ORIGIN` (e.g. `http://192.168.0.2:4200`).

## Build

`npm run build:client` → `dist-web/` at repo root.

Caspar HTML templates are served by the API at `/templates/` (sources under `template/` in this repo).
