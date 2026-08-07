# HighAsCG: server bridge vs browser UI (logical split)

How the repository is organized after WO-52 (**unified playout**: API + **`dist-web/`** on **`:4200`** on the same machine). Use this when deciding what ships on a **closed ISO**, what goes in **`highascg-server_*.tar.gz`** on **`exfat/drop-update/`**, and what stays dev-only.

**Canonical (WO-52):** [`../from_client/AGENT_SERVER_CLIENT_MERGE.md`](../from_client/AGENT_SERVER_CLIENT_MERGE.md), [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)  
**Related:** [`52_FILE_SEPARATION_INVENTORY.md`](52_FILE_SEPARATION_INVENTORY.md), [`../docs/WO47_ISO_VS_EXFAT.md`](../docs/WO47_ISO_VS_EXFAT.md), [`../docs/EXFAT_SERVER_UPDATE.md`](../docs/EXFAT_SERVER_UPDATE.md)

---

## One-line model

> **Client + server in one repo, one playout machine.** Node serves API and web GUI from `dist-web/` (built from **`client/`**). Optional Electron launcher ([highascg-client](https://github.com/mko1989/highascg-client)) = sim, multiserver, modules — **not** the operator UI source tree.

| Layer | Role | Runs where (production) |
|------|------|-------------------------|
| **Server (`index.js` + `src/`)** | Node **bridge**: UI↔Caspar (AMCP) + UI↔Ubuntu (GPU, exFAT, USB, systemd) via REST/WS | Playout machine |
| **UI (`dist-web/`)** | Operator SPA — HTTP/WS to server only (same origin) | **Same playout machine**, served by Node on `:4200` |

**Physical:** one host, one port. **Logical:** the browser still does not speak AMCP or run OS hooks; the server owns playout and hardware.

The in-tree **`client/`** folder is the **canonical operator UI source** — build with `npm run build:client` → **`dist-web/`**; do not deploy raw `client/` to playout. **`HIGHASCG_HEADLESS=true`** is opt-in API-only debug, not the production default.

**`work/`** and **`work/references/`** are engineering notes and design prototypes — **not part of the shipped program**.

---

## What is in the bundled backend

Everything needed to run **`node index.js`** without a browser tab open. In release terms this is **`npm run release:github-server`** → `highascg-server_<UTC>.tar.gz`.

### Entry and orchestration

| Path | Purpose |
|------|---------|
| **`index.js`** | Boot: parse CLI/env, load config, wire Caspar connection, OSC, streaming, timeline engine, HTTP + WS servers |
| **`src/repo-paths.js`** | Repo root; resolves UI dir → `HIGHASCG_WEB_DIR` or `dist-web/` if built, else `client/` |
| **`src/bootstrap/`** | Args, config load (`config/` or `highascg.config.json`), module flags, shutdown, streaming/OSC lifecycles |
| **`src/module-registry.js`** | Optional modules (`previs`, `tracking`, `autofollow`, `cg-studio`) loaded from `src/<module>/register.js` |

### Server surface (what the client calls)

| Path | Purpose |
|------|---------|
| **`src/server/`** | HTTP server (`http-server.js`), WebSocket (`ws-server.js`), CORS, static file hosting for UI + `/templates/` |
| **`src/api/`** | All REST routes: settings, scenes, mixer, media, device view, Caspar config, streaming, USB, exFAT sync, AMCP proxy, etc. (~50 route modules) |

### Caspar and playout intelligence

| Path | Purpose |
|------|---------|
| **`src/caspar/`** | AMCP TCP client, protocol parsing, connection manager, command plans, batching |
| **`src/engine/`** | Scene take, timeline playback, playlists, PIP/global border, layout jobs — **business logic that issues AMCP** |
| **`src/state/`** | Server-side state: playback tracker, live scene, gathered INFO/CLS — **source of truth for `/api/state` and WS broadcasts** |
| **`src/config/`** | Defaults, `ConfigManager`, Caspar XML generator, routing, screen destinations, device graph, pixel mapping |
| **`src/osc/`** | UDP listener for Caspar OSC → `oscState` + Companion-style variables |

### Hardware, media, and OS

| Path | Purpose |
|------|---------|
| **`src/streaming/`** | WebRTC/NDI preview consumers, FFmpeg setup on Caspar, port allocation |
| **`src/media/`** | Local media catalog, USB ingest helpers, CINF parse |
| **`src/sampling/`** | DMX / Art-Net sampling manager |
| **`src/artnet/`**, **`src/audio/`** | Art-Net receiver, audio routing helpers |
| **`src/system/`** | exFAT sync, media partition mount, block devices |
| **`src/utils/`** | Logger, periodic sync, xrandr/GPU layout, hardware inventory, persistence, DeckLink enum, etc. |
| **`src/plugins/`** | Server-side plugin hooks |

### Optional server modules (still under `src/`, not in `client/`)

| Path | Purpose |
|------|---------|
| **`src/previs/`** | 3D previs API + model routes (when `features.previs3d`) |
| **`src/tracking/`**, **`src/autofollow/`** | Tracking / autofollow APIs |
| **`src/cg-studio/`** | CG studio server side |

These modules may register **`webBundles`** URLs under `client/assets/modules/…` — the **server code** stays in `src/`; only the **loader scripts** live in the client tree.

### Repo root shipped with the server bundle

| Path | Purpose |
|------|---------|
| **`package.json`**, **`package-lock.json`** | Node deps: `ws`, `osc`, `xml2js`, `busboy`, `dmxnet`, `sacn`, etc. (`vite` is dev-only) |
| **`config/`** | Modular runtime settings (JSON); Caspar-related fragments |
| **`template/`** | Caspar HTML templates (multiview, LED test, PIP, etc.) — served at `/templates/` |
| **`scripts/`** | Install phases, systemd units, exFAT server-update apply, sudoers |
| **`tools/runtime/`** | `exfat-sync-cli.js`, staged Caspar helpers (only tools subtree on playout) |

### Explicitly **not** in the server-only tarball

| Path | Why |
|------|-----|
| **`client/`**, **`client/tools/`** | UI **sources** + operator kit — not rsync'd as sources to playout |
| **`dist-web/`** | **Required on playout** — built UI served on `:4200` |
| **`tools/smoke/`**, **`tools/eggs/`**, **`tools/release/`** | Dev / build host only |
| **`node_modules/`** | Often omitted from tarball; `npm ci` on target |
| **`media/`**, **`log/`**, **`data/`** (runtime) | Machine-local |
| **`work/`**, **`docs/`**, **`.git`** | Dev/docs only |

### npm dependencies that “belong” to the server

Runtime **`dependencies`** in root `package.json` are for the Node process. Optional packages used mainly in the browser (`three`, `grapesjs`) are listed under **`optionalDependencies`** and loaded from **`client/`** via dynamic import / Vite externals — they are not required for headless API operation.

---

## What went to the client

Formerly under **`client/`** (Companion module layout). Renamed to **`client/`** — pure **ES modules** in the browser, no Node APIs.

### Client-only directories

| Path | Purpose |
|------|---------|
| **`client/index.html`**, **`client/app.js`** | Shell + bootstrap: WS client, panels, routing between workspace tabs |
| **`client/components/`** | UI (~126 modules): header, scenes, timeline, device view, inspectors, settings modals, sources, multiview editor, previs panes, etc. |
| **`client/lib/`** | Browser-side logic: **`api-client.js`**, **`ws-client.js`**, scene/timeline/multiview **state mirrors**, preview canvas math, AMCP preview batching, WebRTC preview client, project persistence UX |
| **`client/styles/`**, **`client/styles.css`** | Layout and theme |
| **`client/assets/`** | Icons, logos, optional module front-end bundles (`assets/modules/previs/`, `cg-studio/`, …) |
| **`client/fonts/`** | Web fonts (e.g. Rewir) |
| **`client/fixtures/`** | Static text fixtures for UI |
| **`client/package.json`** | Marker only (`"type": "module"` scope) — real deps stay at repo root for Vite |

### Production build output (still “client”, not backend)

| Path | Purpose |
|------|---------|
| **`dist-web/`** | Vite output (`npm run build:client`) — minified HTML/JS/CSS the server prefers to serve when present |
| **`vite.config.js`** | Build config: `root: 'client'`, `outDir: '../dist-web'`, dev proxy to `:4200` |

### What the client does **not** do

- No direct AMCP TCP (except optional dev tooling); playout commands go through **`POST /api/...`** or WS AMCP dispatch.
- No Caspar config file generation (server **`src/config/config-generator*.js`**).
- No OSC UDP listener, no systemd, no `xrandr`, no NVIDIA/DeckLink drivers.
- No writing `casparcg.config` or restarting Caspar — client asks server via API.

### Typical client responsibilities (by area)

| Area | Client (`client/`) | Backend (`src/`) |
|------|-------------------|------------------|
| Operator panels | Render, bind forms, drag-drop | Validate, persist, execute |
| Live state display | Subscribe WS, merge into `StateStore` | Own `StateManager`, broadcast deltas |
| Scene / timeline edit | Local edit model, save via API | Apply takes, AMCP sequences |
| Device view cabling | SVG graph, inspector forms | Device graph model, apply OS/Caspar layout |
| Settings | Modal UI, collect payloads | Merge into config, restart services |
| Media browser | Tree UI, thumbnails | Scan disk, `/api/media`, ingest |
| Preview video | WebRTC client, `<video>` | FFmpeg/NDI consumers on Caspar |

---

## How they connect (production)

```
┌─────────────────────────────────────────────────────────────┐
│  Playout machine: highascg.service :4200                    │
│    ├── /api/*  /api/ws  (bridge)                            │
│    └── /*      dist-web/  (operator UI, same origin)        │
│         AMCP → Caspar :5250  ·  shell → Ubuntu OS           │
└─────────────────────────────────────────────────────────────┘
         ▲
         │  http://<playout-ip>:4200/
   Browser on playout or LAN · optional Electron hub opens this URL
```

- **Production playout:** browser (or LAN) → **`http://<playout-ip>:4200/`** — no separate UI port.
- **Dev:** `npm run dev:client` (Vite `:4350`) proxies `/api` to `npm start` (`:4200`). UI sources: in-repo **`client/`**.
- **Optional Electron hub** (Mac/Windows): stick prep / sim — opens **system browser** to playout `:4200`; does **not** embed the control UI.

---

## Distribution: closed ISO vs stick vs GitHub

| Artifact | Backend contents | Client contents |
|----------|------------------|-----------------|
| **Eggs squashfs (WO‑47)** | Caspar shell: `config/casparcg.config`, `lib/`, stubs — **no `src/`**, **no `tools/`** | **Excluded** |
| **exFAT `drop-update/`** | `highascg-server_*.tar.gz` → `index.js`, `src/`, `scripts/`, **`tools/runtime/`**, **`dist-web/`** | UI updated with server drop |
| **`release:github-server`** | Same as server drop (includes **`dist-web/`** unless `RELEASE_SERVER_ONLY=1`) | — |
| **`release:github-client`** | Optional UI-only hotfix tarball | `dist-web/` only |
| **Legacy `sim/highascg/`** | Deprecated for Linux playout | Win/Mac sim only (WO‑50) |

**ISO rebuilds** are rare; **server + UI updates** use **`drop-update/`** (includes **`dist-web/`**).

---

## Summary

- **Server bridge** = `index.js` + **`src/`** + **`scripts/`** + **`tools/runtime/`** + **`config/`**, **`template/`** — Node service between UI, Caspar, and Ubuntu.
- **Operator UI** = **`dist-web/`** on playout — same machine, same port **`:4200`**.
- **Not deployed as sources:** **`client/`** (build into `dist-web/` only), **`work/`**, **`tools/eggs/`**, **`tools/smoke/`**.
- **Electron packaging** ([highascg-client](https://github.com/mko1989/highascg-client)) = optional extract from `client/tools/electron-launcher/` — simulator, multiserver, modules; opens browser to playout `:4200`. **Not** the operator UI source tree.

Keeping **`client/` sources** out of playout drops while shipping **`dist-web/`** allows closed ISOs, stick updates, and UI iteration without separate UI hosting on a laptop.
