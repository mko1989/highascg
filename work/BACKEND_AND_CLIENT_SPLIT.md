# HighAsCG: bundled backend vs client

How the repository is split after the **server-at-root + `client/`** layout (May 2026). Use this when deciding what ships on a **closed ISO**, what goes in **`highascg-server_*.tar.gz`** on **`exfat/update/server/`**, and what runs on **Mac/Windows** as the remote client.

**Related:** [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md), [`52_FILE_SEPARATION_INVENTORY.md`](52_FILE_SEPARATION_INVENTORY.md) (older `client/` naming), [`../docs/WO47_ISO_VS_EXFAT.md`](../docs/WO47_ISO_VS_EXFAT.md), [`../docs/EXFAT_SERVER_UPDATE.md`](../docs/EXFAT_SERVER_UPDATE.md), WO‑51 decoupled architecture.

---

## One-line model

| Side | Role | Runs where |
|------|------|------------|
| **Backend (bundled server)** | Node **bridge**: client↔Caspar (AMCP) + client↔Ubuntu (GPU, exFAT, USB, systemd) via REST/WS | `node index.js` on the playout machine |
| **Client** | Operator UI in **Electron launcher** — HTTP/WS to server only | Operator laptop (`highascg-client` repo); **not** on playout |

The backend **does not** serve operator UI in production (`HIGHASCG_HEADLESS=true`). The in-tree **`client/`** folder is legacy/dev-only and is excluded from server tarballs and playout ISOs (including **`client/tools/electron-launcher/`**).

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
| **`client/`**, **`client/tools/`** | UI + operator launchers — **not** on playout stick |
| **`dist-web/`** | Built UI — `release:github-client` on Mac/Windows |
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

## How they connect

```
┌─────────────────────────────────────────────────────────────┐
│  Operator machine: Electron launcher + dist-web/            │
│  fetch('http://playout:4200/api/...')  WebSocket /api/ws  │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  Playout: index.js + src/  (bridge, headless :4200)       │
│  HTTP router → src/api/*                                   │
│  WS → state + AMCP dispatch                                │
│  Caspar ← AMCP TCP :5250                                   │
│  Ubuntu ← GPU / exFAT / USB / systemd hooks                │
└───────────────────────────────────────────────────────────┘
```

- **Dev:** UI from **highascg-client** (`npm run dev` :3000) or legacy in-tree `client/` — both proxy `/api` to `npm start` (:4200).
- **Production playout:** headless server only; **Electron client** on operator laptop points at server IP.

---

## Distribution: closed ISO vs stick vs GitHub

| Artifact | Backend contents | Client contents |
|----------|------------------|-----------------|
| **Eggs squashfs (WO‑47)** | Caspar shell: `config/casparcg.config`, `lib/`, stubs — **no `src/`**, **no `tools/`** | **Excluded** |
| **exFAT `update/server/`** | `highascg-server_*.tar.gz` → `index.js`, `src/`, `scripts/`, **`tools/runtime/`** | **Not touched** |
| **`release:github-server`** | Same as server drop (includes **`tools/runtime/`** only) | No |
| **`release:github-client`** | No | `dist-web/` — install on Mac/Windows |
| **Legacy `sim/highascg/`** | Deprecated for Linux playout | Win/Mac sim only (WO‑50) |

**ISO rebuilds** are rare; **server updates** use **`update/server/`**. **UI work** is **`client/`** + remote deploy, not the playout stick.

---

## Quick file-count sanity check (repo)

| Tree | Approx. scale |
|------|----------------|
| `src/` | ~22 top-level packages, 50+ API route files — all backend |
| `client/components/` | ~126 UI modules |
| `client/lib/` | ~40 browser helper modules |
| `index.js` | Single orchestrator — backend |

---

## Summary

- **Bundled backend (bridge)** = `index.js` + **`src/`** + **`scripts/`** + **`tools/runtime/`** + **`config/`**, **`template/`** + root **`package.json`** — headless Node service between client, Caspar, and Ubuntu.
- **Client** = **highascg-client** Electron launcher + **`dist-web/`** — operator UI; **never** on playout ISO/server tarball.
- **Not shipped:** **`client/`** (legacy in-repo), **`work/`**, **`work/references/`**, **`tools/eggs/`**, **`tools/smoke/`**.

Keeping that boundary strict is what allows a **closed ISO**, **server-only exFAT updates**, and **client-first** iteration without reflashing the image.
