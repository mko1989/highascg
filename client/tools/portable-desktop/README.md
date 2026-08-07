# HighAsCG portable simulation launcher (WO‑50)

Prep / offline use: runs the HighAsCG server **without Caspar** (`node index.js --no-caspar`). AMCP responses come from **`src/caspar/amcp-simulated.js`** — suitable for timelines, placeholders, offline prep ([WO‑37](../../../work/work-orders/37_WO_SIMULATION_PLACEHOLDERS.md)). The repo is unified: the simulator runs straight from **this checkout** (UI + API + CG Studio module, same as production).

## Non‑goals (WO‑50 F3)

Programming prep only — **not** a supported on‑air production setup. No real Caspar AMCP, no DeckLink / playout guarantees. Production runs the usual studio / rack lane.

## Run

From the repo root (Node ≥ 20, `npm install` once):

```bash
npm run portable:sim
```

Syntax check: `npm run portable:sim:check`. The Electron GUI (`npm run launcher`) uses the same resolver and helper script.

App-root resolution order (`sim-app-root.cjs`):

1. `HIGHASCG_SIM_APP_ROOT` / `HIGHASCG_EXFAT_APP_ROOT` env overrides
2. the repo checkout containing this file (dev default)
3. `sim-server/` bundled next to a packaged launcher app
4. current directory — only with `--use-cwd` / `SIM_USE_CWD=1`
5. the `HIGHASCGEXF` exFAT volume (`{volume}/sim/highascg`) — only with `HIGHASCG_SIM_ALLOW_EXFAT=1`

### Operator wrappers (stick)

The stick carries the full repo under `HIGHASCGEXF/sim/highascg`; run `npm ci` there once, then double‑click:

- Windows: `client/tools/portable-desktop/win/HighAscg-Simulation.cmd`
- macOS: `client/tools/portable-desktop/mac/HighAscg-Simulation.command` (`chmod +x` first; Gatekeeper: Right‑click → Open)

Both resolve their own location, so they work from any working directory. Manual stick layout: `tools/eggs/live-usb/MANUAL_STICK_WINDOWS_MACOS.md` (WO‑47).

## Optional overrides

| Variable | Meaning |
|---------|---------|
| `HIGHASCG_SIM_APP_ROOT` / `HIGHASCG_EXFAT_APP_ROOT` | Force full app directory (must contain `index.js`) |
| `HIGHASCG_EXFAT_ROOT` | Force data volume root — app = `{root}/sim/highascg` (needs `HIGHASCG_SIM_ALLOW_EXFAT=1`) |
| `HIGHASCG_SIM_ALLOW_EXFAT` | `1` = allow resolving the app from the exFAT stick |
| `SIM_USE_CWD` / `--use-cwd` | Treat current directory as the app root |
| `HIGHASCG_LAUNCH_NO_BROWSER` | `1` = do not auto-open the browser |
| `HIGHASCG_LAUNCH_BROWSER_DELAY_MS` | Milliseconds before opening UI (default `2500`) |
| `HIGHASCG_LAUNCH_PORT_FALLBACK` | `N`: if `httpPort` is busy, try up to `httpPort+N` (passes `--port`); `0` = fail fast (default) |
| `HIGHASCG_LAUNCH_SKIP_PORT_CHECK` | `1` = skip the TCP bind probe (also skips `--port` injection) |
| `HIGHASCG_LAUNCH_INJECT_CLI_PORT` | `0` = never append `--port` (advanced) |
| `HIGHASCG_LAUNCH_NO_OFFLINE_DEFAULT` | `1` = do not default `HIGHASCG_OFFLINE_MODE=1` |
| `HIGHASCG_OFFLINE_MODE` | Passed to `index.js`; the launcher defaults it to `1` unless set / disabled above |
| `BIND_ADDRESS`, `HTTP_PORT` / `PORT` / `HIGHASCG_PORT` | Preferred `bindAddress` / `httpPort` for the probe (same semantics as `index.js`) |

### `offline_mode` vs `--no-caspar`

`--no-caspar` cuts real AMCP TCP. `offline_mode` also shapes UI / stubs (host stats, "connected" state, periodic sync skips). Prep on a laptop typically wants both; the launcher sets `HIGHASCG_OFFLINE_MODE=1` by default.

## Troubleshooting

- **No server tree found** — run from the repo checkout after `npm install`, or set `HIGHASCG_SIM_APP_ROOT`.
- **Missing node_modules** — `npm install` (repo checkout) / `npm ci` (stick payload) in the app root.
- **Port already in use** — stop the other `node`, edit `config/server.json`, set `HTTP_PORT`, or `HIGHASCG_LAUNCH_PORT_FALLBACK=16`.
- **Cannot find HIGHASCGEXF** (opt-in stick mode) — check the volume label, or set `HIGHASCG_EXFAT_ROOT`.
- **Firewall** — allow `node` for local HTTP (default **4200**).

Packaged `.exe` / signed `.app` bundles are tracked in WO‑50; this folder is the reference implementation.
