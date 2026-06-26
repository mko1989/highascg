# HighAsCG portable simulation launcher (WO‑50)

Prep / offline use: runs **without Caspar** (`--no-caspar`) from the **`HIGHASCGEXF`** exFAT slice (`…/sim/highascg`). If the stick isn’t mounted, **`npm run portable:sim`** falls back to the **current directory** when it looks like the HighAsCG repo (dev workstations).

AMCP responses come from **`src/caspar/amcp-simulated.js`**. Suitable for timelines, placeholders, offline prep ([WO‑37](../../work/work-orders/37_WO_SIMULATION_PLACEHOLDERS.md)).

## Non‑goals (WO‑50 **F3**)

This launcher and simulation path exist for **programming prep** — timelines, placeholders, offline work — **not** as a supported **on‑air production** setup.

In particular:

- **No Caspar guarantees** — you are not connecting to real **Caspar CG** AMCP (`--no-caspar`; simulated responses only).
- **No DeckLink / playout guarantees** — there is **no commitment** that graphics, timing, hardware I/O, or operator workflows match a **Linux + Caspar + DeckLink** booth.
- **Production** remains the usual **studio / rack** lane (validated stack, cabling, clocks, etc.). If you need real Caspar and cards, run the approved **production** image or host, not this portable sim shortcut.

Bundled installers, signing, notarization, and CI‑built artifacts are **out of scope** for this README until WO‑50 §D–§E land.


## Operator CLI (Mac / Windows)

End-to-end **`prepare-stick`** (ISO + **`HIGHASCGEXF`** + release **`.tar.gz`** or unpacked repo) and **`sim`** routing live in **`tools/operator-desktop/`**:

```bash
npm run operator-kit -- prepare-stick --iso path/to.iso --tar-gz path/to/highascg_….tar.gz
npm run operator-kit -- sim
```

See **[`tools/operator-desktop/README.md`](../operator-desktop/README.md)**.

## Prerequisites

1. Stick or disk with volume label **`HIGHASCGEXF`** (manual steps: **`tools/live-usb/MANUAL_STICK_WINDOWS_MACOS.md`**).
2. Unzipped HighAsCG under **`HIGHASCGEXF/sim/highascg`** (must contain **`package.json`**).
3. **Node ≥ 20** on `PATH`.
4. One-time install in that folder: **`npm ci`**.

### Optional overrides

| Variable | Meaning |
|---------|---------|
| `HIGHASCG_EXFAT_ROOT` | Force **data volume root** — app = `{root}/sim/highascg` (or `root` itself if it already has **`package.json`**) |
| `HIGHASCG_EXFAT_APP_ROOT` | Force full app directory (must contain **`package.json`**) |
| `HIGHASCG_LAUNCH_NO_BROWSER` | Set to `1` to not auto-open browser |
| `HIGHASCG_LAUNCH_SKIP_PORT_CHECK` | Set to `1` to skip TCP bind probe (**`HIGHASCG_LAUNCH_INJECT_CLI_PORT`** stays aligned: inject is also skipped). Auto‑open browser may target the **pre‑resolved** port while the child still reads disk config — confirm **`HTTP_PORT`/`-p`** yourself if mismatched.
| `HIGHASCG_LAUNCH_PORT_FALLBACK` | Non‑negative integer (**`N`**): if base **`httpPort`** is busy, try **`httpPort`**+1 … **`httpPort+N`** (`0` = fail fast — default). Matches chosen port to **`index.js`** via **`--port`**. |
| `HIGHASCG_LAUNCH_INJECT_CLI_PORT` | **`0`** = do not append **`--port`** (advanced; avoids double‑binding checks when probing is skipped — child must match **`HTTP_PORT`/`BIND_ADDRESS`** semantics yourself). |
| `HIGHASCG_LAUNCH_NO_OFFLINE_DEFAULT` | **`1`** = do **not** set **`HIGHASCG_OFFLINE_MODE=1`** by default — rely on **`config/general.json`** / monolithic **`offline_mode`** only. |
| `HIGHASCG_LAUNCH_BROWSER_DELAY_MS` | Milliseconds before opening UI (default `2500`) |
| `SIM_USE_CWD=1` | Dev shortcut: treat current directory as **`sim/highascg`** |
| `BIND_ADDRESS`, `HTTP_PORT` / `PORT` / `HIGHASCG_PORT` | Resolve the **preferred** **`httpPort`** / **`bindAddress`** for the probe (**`BIND_ADDRESS`** / port env behave like **`index.js`** / bootstrap). **`index.js`** still loads **`HIGHASCG_OFFLINE_MODE`** from env (below). |
| `HIGHASCG_OFFLINE_MODE` | Passed through to **`index.js`**: **`1`/`true`** or **`0`/`false`** overrides **`offline_mode`** after loading config (**`buildConfig`** in **`src/bootstrap/config.js`**). Launcher **defaults** **`HIGHASCG_OFFLINE_MODE=1`** unless you set **`HIGHASCG_LAUNCH_NO_OFFLINE_DEFAULT=1`** or set **`HIGHASCG_OFFLINE_MODE`** yourself. |

### `offline_mode` vs `--no-caspar`

**`--no-caspar`** cuts real AMCP TCP. **`offline_mode`** also shapes UI / stubs (host stats, “connected” state, periodic sync skips, …). Prep on a laptop typically wants **both**. The launcher sets **`HIGHASCG_OFFLINE_MODE=1`** unless you disable that default (see **`HIGHASCG_LAUNCH_NO_OFFLINE_DEFAULT`**). Alternatively set **`"offline_mode": true`** in **`config/general.json`** (modular tree) or the monolithic **`highascg.config.json`**; env still wins **after** **`ConfigManager`** load when **`HIGHASCG_OFFLINE_MODE`** is set.

## Run

From repo checkout (developers):

```bash
npm run portable:sim
```

CI / quick syntax check: **`npm run portable:sim:check`** (`ubuntu-latest`: **`.github/workflows/portable-desktop-check.yml`**).


Or explicitly:

```bash
node tools/portable-desktop/launch-sim-from-exfat.js
```

Append extra **`index.js`** flags after `--` if you add forwarding later; currently everything after script name passes through to **`index.js`**.

### Windows (operator)

Double-click **`tools/portable-desktop/win/HighAscg-Simulation.cmd`** from an **explorer** rooted at **`sim/highascg`** (opened from the **`HIGHASCGEXF`** drive),  
or **Run** from **`sim/highascg`** in cmd:

```bat
tools\portable-desktop\win\HighAscg-Simulation.cmd
```

### macOS (operator)

Terminal:

```bash
cd "/Volumes/HIGHASCGEXF/sim/highascg"
chmod +x tools/portable-desktop/mac/HighAscg-Simulation.command
open tools/portable-desktop/mac/HighAscg-Simulation.command
```

## Troubleshooting

- **Cannot find HIGHASCGEXF** — plug stick, confirm label in Explorer / Finder; **or** `set HIGHASCG_EXFAT_ROOT=E:` (Windows) / export on macOS.
- **missing node_modules** — run **`npm ci`** inside **`sim/highascg`**.
- **Port already in use** — stop the other **`node`**, edit **`highascg.config.json`** / **`config/server.json`**, or set **`HTTP_PORT`**. **Or** **`HIGHASCG_LAUNCH_PORT_FALLBACK=16`** so the launcher tries the next ports and passes **`--port`** accordingly. Probe skip (**`HIGHASCG_LAUNCH_SKIP_PORT_CHECK=1`**) skips only the parent check — the child may still hit **`EADDRINUSE`**.
- **Firewall** — allow **`node`** for local HTTP (default usually **4200**; see **`highascg.config.json`** or **`config/server.json`**).
- **`powershell` blocked** (Windows discovery) — set **`HIGHASCG_EXFAT_ROOT`** or **`HIGHASCG_EXFAT_APP_ROOT`**.
- **BitLocker / encrypted stick** — the exFAT **`HIGHASCGEXF`** volume must mount normally; full‑disk encryption from Windows can block macOS/Linux from seeing the partition — follow **`tools/live-usb/MANUAL_STICK_WINDOWS_MACOS.md`** / **WO‑47** for layout.
- **Antivirus locks `node.exe` or `npm`** — allowlist the **`sim/highascg`** tree; run **`npm ci`** once before first launch.
- **macOS Gatekeeper** — **`.command`** files are not notarized; use **Right‑click → Open** the first time or allow under **Privacy & Security**. Signed **`.app`** bundles are future **WO‑50 §D**.
- **Rare `EACCES` on exFAT** — verify the volume isn’t hardware read‑only.

Packaged `.exe` / signed `.app` bundles are tracked in WO‑50; this folder is the **reference implementation**.
