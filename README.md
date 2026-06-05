# HighAsCG

HighAsCG is a Node.js **bridge service** on the playout machine. It connects the **operator client** (Electron + web UI on a laptop) to **CasparCG** (AMCP playout) and to **Ubuntu OS** APIs (GPU layout, exFAT, USB ingest, hardware settings). It runs HTTP + WebSocket on port **4200**; it does **not** host the operator UI in production.

**Architecture (canonical):** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

**This repository is the source tree for the server** that goes into the [live ISO](docs/ISO_CONTENTS.md) and exFAT server drops (Ubuntu stack, CasparCG, installer, systemd, Node under `src/`). WO‑47 loads the server from exFAT (`drop-update/`) using release tarballs from this repo.

**Browser UI (client):** separate repository [**highascg-client**](https://github.com/mko1989/highascg-client) — Vite UI + **Electron launcher** on the **operator machine**. The in-tree **`client/`** folder here is legacy/dev-only and is **not** deployed to the playout server (especially not `client/tools/electron-launcher/`).

**Playout server (this repo):** API + WebSocket bridge only (`HIGHASCG_HEADLESS=true` via systemd). See [`docs/PLAN_SERVER_CLIENT_SPLIT.md`](docs/PLAN_SERVER_CLIENT_SPLIT.md).

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

**Production (playout + operator laptop):** API on the playout host (`highascg.service`, port **4200**); UI from [**highascg-client**](https://github.com/mko1989/highascg-client) (`npm run launcher`). See [`docs/PLAN_SERVER_CLIENT_SPLIT.md`](docs/PLAN_SERVER_CLIENT_SPLIT.md).

**Dev — split (canonical):**

| Machine | Repo | Command |
|---------|------|---------|
| Playout / API host | **this repo** | `npm start` — API **:4200** |
| Operator laptop | **highascg-client** | `npm run dev` — UI **:3000** (`VITE_HIGHASCG_API_ORIGIN=http://<playout-ip>:4200`) |
| Operator laptop | **highascg-client** | `npm run launcher` — Electron |

**Deploy server to playout host:** `npm run deploy:dev` (server-only tarball; see `scripts/dev-push.sh`).

**Legacy monolith (deprecated):** `npm run start:monolith` only if you still serve built `dist-web/` from the API host.

## Project layout

| Path | Role | On playout server? |
|------|------|--------------------|
| `index.js`, [`src/`](src/) | Node **bridge** — Caspar AMCP, REST `/api/*`, WebSocket, OS hooks | **Yes** |
| — | UI: [**highascg-client**](https://github.com/mko1989/highascg-client) + Electron launcher (operator laptop) | **No** |
| `client/` | Legacy in-tree browser UI (dev); **not** in server tarball or ISO | **No** |
| `work/` | Work orders, references, planning — **not part of the program** | **No** |
| `config/` | Modular settings (runtime JSON; see `.gitignore`) | **Yes** |
| `template/` | Caspar HTML templates | **Yes** |
| `scripts/` | Production installer, systemd — [`scripts/README.md`](scripts/README.md) | **Yes** |
| `tools/runtime/` | exFAT sync CLI, staged Caspar start | **Yes** |
| `tools/eggs/`, `tools/smoke/` | ISO build host, dev tests | **No** |

**Dev:** `npm start` (API **:4200**) · UI in [**highascg-client**](https://github.com/mko1989/highascg-client).

**Eggs build host:** use only `~/highascg`. Remove stale `~/highascg-server` / `~/highascg-frontend` if present (`npm run clean:eggs-host`).

Migration notes and file mapping: `work/01_WO_ANALYZE_MODULE.md`, `work/02_WO_MIGRATE_TO_HIGHASCG.md` (local `work/` tree). Architecture catalog: **`work/PROJECT_BREAKDOWN.md`**. Work-order status snapshot: **`work/project_status.md`**.

## Verify

```bash
npm run verify:structure
find src client -name "*.js" | xargs wc -l | sort -n
```

With the server running (`npm start` or `node index.js --port 4200`), in another terminal:

```bash
npm run smoke -- 4200
# or: node tools/smoke/http-smoke.js 4200
# Other checks (no Caspar / optional):
# npm run smoke:companion-press
# npm run smoke:streaming-ch 4200
```

This checks HTTP (`/`, `/api/scene/live`, `/api/state`, **`/api/settings`**, **`/api/streams`**, **`/api/audio/devices`**, unknown route) and WebSocket initial `state` message.

**With CasparCG connected** (GET `/api/state` → 200), also run:

```bash
npm run smoke:caspar -- 4200
```

This asserts unknown routes return **404** (not 503) and **`POST /api/raw`** with `VERSION` succeeds.

The web client **refreshes** cached settings and streaming status on WebSocket reconnect and after **Save** in Application Settings.

**Browser monitoring** (Settings → Audio / OSC → *Browser monitoring preference*) applies to WebRTC preview audio: **PGM** unmutes and listens to the PGM stream; **Off** mutes monitoring. The header shows **Live**/**HTTP** plus **Caspar** / **Caspar offline** / **no AMCP** (`--no-caspar`). **`GET /api/streams`** uses the same **`getApiBase()`** prefix as other API calls when the app is served under **`/instance/…`**.

For deeper integration checks against a live CasparCG, use **`npm run smoke`** / **`npm run smoke:caspar`** and the notes in **[`docs/README.md`](docs/README.md)**.
