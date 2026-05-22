# HighAsCG

HighAsCG is a Node.js control and configuration service built around CasparCG. It runs its own HTTP + WebSocket server, connects to CasparCG over AMCP, and allows to play looks / scenes / timeline / multiview on connected displays from a browser user interface.

**This repository is the source tree for everything that goes into the [live ISO](docs/ISO_CONTENTS.md)** (Ubuntu, NVIDIA/DeckLink stack, CasparCG, installer, systemd units, and the Node server under `src/`). The hybrid image is built from this checkout on the eggs host; WO‑47 then loads the server from exFAT (`drop-update/`) using release tarballs produced from the same repo.

**Browser UI (client):** operator-facing HTML/CSS/JS lives in [`client/`](client/) ([`client/README.md`](client/README.md)). Built with `npm run build:client` → `dist-web/`, hosted by the [**Electron launcher**](client/tools/electron-launcher/) on the operator machine — **not** served from the playout server (see [`docs/PLAN_SERVER_CLIENT_SPLIT.md`](docs/PLAN_SERVER_CLIENT_SPLIT.md)).

**Playout server:** API + WebSocket only (`HIGHASCG_HEADLESS=true` via systemd). **Operator UI:** `npm run launcher:prepare` then `npm run launcher` ([`client/tools/electron-launcher/README.md`](client/tools/electron-launcher/README.md)).

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
| `HTTP_PORT` or `PORT` | API server port (default **4200** in `src/config/defaults.js`) |
| `HIGHASCG_HEADLESS` | `true` / `1` — API only; no static UI (default on playout via systemd) |
| `BIND_ADDRESS` | Listen address (default `0.0.0.0`) |
| `HIGHASCG_WS_BROADCAST_MS` | Optional periodic WebSocket state push (ms; `0` = off) |
| `OSC_LISTEN_PORT` | OSC UDP port (default `6251`; Caspar `<default-port>` is typically `6250`) |
| `OSC_BIND_ADDRESS` | OSC bind address (default `0.0.0.0`) |
| `HIGHASCG_OSC_WS_DELTA` | `1` / `true` — WebSocket `osc` messages send partial `{ delta: true, channels: { … } }` per throttle (merge client-side); default full snapshot each emit |
| `CASPAR_ARM_FILE` | Path touched when “arming” staged Caspar startup (default `/home/casparcg/highascg/data/caspar-armed`; same path as `tools/runtime/casparcg-staged-start.sh`) |

CLI flags (see `node index.js --help`): `--port`, `--caspar-host`, `--caspar-port`, `--bind`, `--no-caspar` (Caspar-dependent AMCP routes return **503**; **settings**, **audio device list**, `/api/streams`, and **streaming toggle** still work), `--no-osc` (disable OSC UDP), `--ws-broadcast-ms`.

### APIs without Caspar (`--no-caspar` or Caspar down)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/settings` · `POST /api/settings` | OSC, streaming, UI, `audioRouting`, Caspar host (saved for reconnect) |
| `GET /api/hardware/displays` | System tab display names |
| `GET /api/audio/devices` | ALSA / PipeWire list for Audio settings |
| `POST /api/audio/config` | Persist `audioRouting` |
| `GET /api/streams` | Streaming status and preview pipeline readiness (`stream-state.js`) |
| `POST /api/streaming/toggle` · `…/restart` | Start/stop streaming consumers (need Caspar when connected) |
| `GET /api/osc/*` | OSC listener config / snapshot |

Caspar still required for playout, mixer (`/api/mixer/*` except audio volume wrapper), media lists, etc.

### OSC (CasparCG → HighAsCG)

CasparCG should send OSC over UDP (see **`docs/osc-integration.md`**). HighAsCG listens on **`OSC_LISTEN_PORT`** (default **6251**) and aggregates messages into **`appCtx.oscState`**. Use **`--no-osc`** only to skip the UDP listener (e.g. development).

### Staged Caspar startup (production)

On a playout machine you can start **media scanner** and **HighAsCG** first, change or upload Caspar config, then **arm** Caspar so the supervisor script starts `casparcg-server`.

- Shell helpers: `tools/runtime/casparcg-staged-start.sh`, `tools/runtime/start-highascg.sh` — see **`tools/README.md`**.
- Default ready file: `/home/casparcg/highascg/data/caspar-armed` (override with **`CASPAR_ARM_FILE`** on HighAsCG and the same variable for the bash script if you keep paths in sync).
- HTTP (no Caspar required): **`GET /api/system/caspar-arm`** (status), **`POST /api/system/caspar-arm`** (create ready file), **`DELETE /api/system/caspar-arm`** (remove it).

## Usage

**Production (playout + operator laptop):** API on the playout host (`highascg.service`, port **4200**); UI in **`npm run launcher`** (Electron). See [`docs/PLAN_SERVER_CLIENT_SPLIT.md`](docs/PLAN_SERVER_CLIENT_SPLIT.md).

**Dev — split (same as ISO / production):**

| Machine | Command |
|---------|---------|
| Playout / API host | `npm start` — API only **:4200** (`HIGHASCG_HEADLESS` set in script + `.env`) |
| Operator laptop | `npm run dev:client` — UI **:3000** (set `VITE_HIGHASCG_API_ORIGIN` in `.env.development` to playout IP) |
| Operator laptop | `npm run launcher` — Electron UI (set playout host in launcher) |

Remote UI: copy `.env.development.example` → `.env.development` with `VITE_HIGHASCG_API_ORIGIN=http://<playout-ip>:4200`.

**Dev — legacy monolith (deprecated):** `npm run start:monolith` serves `client/` or `dist-web/` on the API port.

**Deploy API to dev playout host:** `npm run deploy:dev` (server-only; writes `HIGHASCG_HEADLESS=true` in remote `.env`).

## Project layout

| Path | Role |
|------|------|
| `index.js`, [`src/`](src/) | Node server — Caspar AMCP, REST `/api/*`, WebSocket |
| [`client/`](client/) | Browser UI — static ES modules ([`client/README.md`](client/README.md)) |
| `dist-web/` | Vite build output — packaged in Electron / `release:github-client`, not on playout ISO |
| `config/` | Modular settings (runtime JSON; see `.gitignore`) |
| `template/` | Caspar HTML templates |
| `scripts/` | Production installer, systemd — [`scripts/README.md`](scripts/README.md) |
| `tools/` | Live USB, smoke tests, operator launcher |

**Dev:** `npm start` (API **:4200**) · `npm run dev:client` (UI **:3000**) · `npm run launcher` (Electron).

**Eggs build host:** use only `~/highascg`. Remove stale `~/highascg-server` / `~/highascg-frontend` if present (`npm run clean:eggs-host`).

Migration notes and file mapping: `work/01_WO_ANALYZE_MODULE.md`, `work/02_WO_MIGRATE_TO_HIGHASCG.md` (local `work/` tree). Architecture catalog: **`work/PROJECT_BREAKDOWN.md`**. Work-order status snapshot: **`work/project_status.md`**.

## Verify

```bash
npm run verify:structure
find src client -name "*.js" | xargs wc -l | sort -n
```

With the server running (`npm start` or `node index.js --port 8080`), in another terminal:

```bash
npm run smoke -- 8080
# or: node tools/smoke/http-smoke.js 8080
# Other checks (no Caspar / optional):
# npm run smoke:companion-press
# npm run smoke:streaming-ch 8080
```

This checks HTTP (`/`, `/api/scene/live`, `/api/state`, **`/api/settings`**, **`/api/streams`**, **`/api/audio/devices`**, unknown route) and WebSocket initial `state` message.

**With CasparCG connected** (GET `/api/state` → 200), also run:

```bash
npm run smoke:caspar -- 8080
```

This asserts unknown routes return **404** (not 503) and **`POST /api/raw`** with `VERSION` succeeds.

The web client **refreshes** cached settings and streaming status on WebSocket reconnect and after **Save** in Application Settings.

**Browser monitoring** (Settings → Audio / OSC → *Browser monitoring preference*) applies to WebRTC preview audio: **PGM** unmutes and listens to the PGM stream; **Off** mutes monitoring. The header shows **Live**/**HTTP** plus **Caspar** / **Caspar offline** / **no AMCP** (`--no-caspar`). **`GET /api/streams`** uses the same **`getApiBase()`** prefix as other API calls when the app is served under **`/instance/…`**.

For deeper integration checks against a live CasparCG, use **`npm run smoke`** / **`npm run smoke:caspar`** and the notes in **[`docs/README.md`](docs/README.md)**.
