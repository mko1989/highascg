# HighAsCG Electron launcher

Operator **prep kit** (flash / exFAT guides) plus **embedded control UI** (`dist-web/`).

This app hosts the Web UI on port **4350** (`client/lib/webui-port.json`) and points it at the server with `window.__HIGHASCG_API_ORIGIN__`.

## Run

From repo root:

```bash
npm install          # once
npm run launcher
```

To embed the control UI in the launcher window, sync a fresh build first:

```bash
npm run build:client
bash client/tools/electron-launcher/sync-dist-web.sh   # copies dist-web/ here for packaging/embedding
```

## Connect to playout

1. Set **Playout API host** and **HTTP port** (default **4200**).
2. Click **Open Control UI (embedded)** — opens a second window (`highascg://app/…`).
3. Optional: **Open in system browser** — legacy; only works if the server still serves static files.

## CG Studio

CG Studio is served **in-process by the HighAsCG server** (`src/cg-studio/` via the module registry): UI at `/cg-studio/index.html`, API at `/api/cg-studio`, enabled by default. The simulator (`node index.js --no-caspar`) serves the same module.

Clicking **CG Studio** (header or Simulation tab) opens a window at `http://<server>:<port>/cg-studio/index.html` for the server configured in the header — the launcher no longer hosts a local studio server. Standalone dev mode for the module itself: `npm run cg-studio` (see `docs/MODULES.md`).

## Simulation

**Start Simulation** runs a local API child (`node index.js --no-caspar`) from the **repo checkout** — the launcher resolves the server tree via `client/tools/portable-desktop/sim-app-root.cjs` (env override → repo root → bundled `sim-server/` in a packaged app). Opens the embedded UI against `http://127.0.0.1:<port>`.

## Packaging

```bash
npm run build:client
bash client/tools/electron-launcher/sync-dist-web.sh        # dist-web/
bash client/tools/electron-launcher/sync-launcher-bundle.sh # lib/ + portable-sim/
bash client/tools/release/build-launcher-packages.sh        # multi-platform folders under dist/launcher-pack/
```

**System Node.js is not required** on the operator machine. The zip ships **Electron** (Chromium + embedded Node for the prep UI). **Start Simulation** uses the same `HighAsCG-Launcher.exe` with `ELECTRON_RUN_AS_NODE=1` — still no separate Node install. A packaged app can ship an optional `sim-server/` tree (a server checkout with `node_modules`) next to the launcher for offline simulation.

The packager only includes files under `client/tools/electron-launcher/` (see `sync-launcher-bundle.sh`). A dev checkout that never ran the sync scripts above will produce a broken zip (missing `lib/webui-port.cjs`, etc.).
