# HighAsCG

Standalone CasparCG control server and web UI, migrated from the `companion-module-casparcg-server` Companion module. It runs its own HTTP + WebSocket server, connects to CasparCG over AMCP, and serves the dashboard / scenes / timeline / multiview tools in a browser.

## Requirements

- **Node.js** ≥ 20 (LTS **20** or **22** recommended; Ubuntu’s `apt install nodejs` is often **18** — too old; use [NodeSource](https://github.com/nodesource/distributions) or see `.nvmrc` for local dev)
- **CasparCG** reachable on the configured AMCP port (default `5250`) for full API behaviour

## Install

```bash
cd HighAsCG
npm install
```

## Configuration

Defaults live in `config/default.js`. Override with environment variables:

| Variable | Purpose |
|----------|---------|
| `CASPAR_HOST` | CasparCG host (default `127.0.0.1`) |
| `CASPAR_PORT` | AMCP port (default `5250`) |
| `HTTP_PORT` or `PORT` | HTTP server port (default `8080`) |
| `BIND_ADDRESS` | Listen address (default `0.0.0.0`) |
| `HIGHASCG_WS_BROADCAST_MS` | Optional periodic WebSocket state push (ms; `0` = off) |
| `OSC_LISTEN_PORT` | OSC UDP port (default `6250`) |
| `OSC_BIND_ADDRESS` | OSC bind address (default `0.0.0.0`) |
| `HIGHASCG_OSC_WS_DELTA` | `1` / `true` — WebSocket `osc` messages send partial `{ delta: true, channels: { … } }` per throttle (merge client-side); default full snapshot each emit |
| `CASPAR_ARM_FILE` | Path touched when “arming” staged Caspar startup (default `/opt/casparcg/data/caspar-armed`; same path as `tools/casparcg-staged-start.sh`) |

CLI flags (see `node index.js --help`): `--port`, `--caspar-host`, `--caspar-port`, `--bind`, `--no-caspar` (Caspar-dependent AMCP routes return **503**; **settings**, **audio device list**, **go2rtc `/api/streams`**, and **streaming toggle** still work), `--no-osc` (disable OSC UDP), `--ws-broadcast-ms`.

### APIs without Caspar (`--no-caspar` or Caspar down)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/settings` · `POST /api/settings` | OSC, streaming, UI, `audioRouting`, Caspar host (saved for reconnect) |
| `GET /api/hardware/displays` | System tab display names |
| `GET /api/audio/devices` | ALSA / PipeWire list for Audio settings |
| `POST /api/audio/config` | Persist `audioRouting` |
| `GET /api/streams` | go2rtc stream list + WebRTC preview (`stream-state.js`) |
| `POST /api/streaming/toggle` · `…/restart` | Start/stop go2rtc (FFmpeg SRT consumers need Caspar when connected) |
| `GET /api/osc/*` | OSC listener config / snapshot |

Caspar still required for playout, mixer (`/api/mixer/*` except audio volume wrapper), media lists, etc.

### OSC (CasparCG → HighAsCG)

CasparCG should send OSC over UDP (see **`docs/osc-integration.md`**). HighAsCG listens on **`OSC_LISTEN_PORT`** (default **6250**) and aggregates messages into **`appCtx.oscState`**. Use **`--no-osc`** only to skip the UDP listener (e.g. development).

### Staged Caspar startup (production)

On a playout machine you can start **media scanner** and **HighAsCG** first, change or upload Caspar config, then **arm** Caspar so the supervisor script starts `casparcg-server`.

- Shell helpers: `tools/casparcg-staged-start.sh`, `tools/start-highascg.sh` — see **`tools/README.md`**.
- Default ready file: `/opt/casparcg/data/caspar-armed` (override with **`CASPAR_ARM_FILE`** on HighAsCG and the same variable for the bash script if you keep paths in sync).
- HTTP (no Caspar required): **`GET /api/system/caspar-arm`** (status), **`POST /api/system/caspar-arm`** (create ready file), **`DELETE /api/system/caspar-arm`** (remove it).

## Usage

```bash
npm start
# or
node index.js
```

Open the printed URL (e.g. `http://127.0.0.1:8080/`). WebSocket clients use the same port at `/api/ws` (and `/ws`). If the UI is opened under a Companion-style prefix (`/instance/<id>/`), the client uses `/instance/<id>/api/*` and `/instance/<id>/api/ws`; the server accepts those paths directly (not only when a reverse proxy strips the prefix). Static assets (`index.html`, `app.js`, `styles.css`, …) are also served under `/instance/<id>/…` so relative URLs work when you load `http://host:port/instance/myid/`.

## Project layout

- `index.js` — entry point, Caspar `ConnectionManager`, HTTP, WebSocket
- `src/server/` — HTTP static + API, WebSocket
- `src/caspar/` — TCP, AMCP protocol, `AmcpClient`
- `src/api/` — REST routers
- `src/engine/` — scenes, timelines
- `web/` — static SPA (dashboard, editors)
- `scripts/` — production installer (`install.sh` + phases), dev deploy, smoke tests, staged Caspar helpers — see **`scripts/README.md`**

See `01_WO_ANALYZE_MODULE.md` and `02_WO_MIGRATE_TO_HIGHASCG.md` in this repo for migration notes and file mapping.

## Verify

```bash
node tools/verify-w02-structure.js
find src/ web/ -name "*.js" | xargs wc -l | sort -n
```

With the server running (`npm start` or `node index.js --port 8080`), in another terminal:

```bash
npm run smoke -- 8080
# or: node tools/http-smoke.js 8080
```

This checks HTTP (`/`, `/api/scene/live`, `/api/state`, **`/api/settings`**, **`/api/streams`**, **`/api/audio/devices`**, unknown route) and WebSocket initial `state` message.

**With CasparCG connected** (GET `/api/state` → 200), also run:

```bash
npm run smoke:caspar -- 8080
```

This asserts unknown routes return **404** (not 503) and **`POST /api/raw`** with `VERSION` succeeds.

The web client **refreshes** cached settings and **go2rtc stream list** on WebSocket reconnect and after **Save** in Application Settings (so WebRTC preview and header monitoring controls update without waiting for the 10s poll).

**Browser monitoring** (Settings → Audio / OSC → *Browser monitoring preference*) applies to WebRTC preview audio: **PGM** unmutes and listens to the PGM stream; **Off** mutes monitoring. The header shows **Live**/**HTTP** plus **Caspar** / **Caspar offline** / **no AMCP** (`--no-caspar`). **`GET /api/streams`** uses the same **`getApiBase()`** prefix as other API calls when the app is served under **`/instance/…`**.

For deeper integration checks against a live CasparCG, use **`npm run smoke`** / **`npm run smoke:caspar`** and the notes in **`docs/`**.
