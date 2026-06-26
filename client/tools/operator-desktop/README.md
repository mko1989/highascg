# Desktop operator kit (Mac / Windows / Linux)

Prepare a **bootable USB** (live **ISO** + **release** on exFAT) or start **simulation** (no Caspar).

## Minimal GUI launcher (recommended)

**Requirements:** **Node.js ≥ 20** for running the Electron launcher and simulation environment.

```bash
cd /path/to/highascg
npm run launcher
```

Double-click (from repo root layout):

| OS | File |
|----|------|
| **Linux / macOS** | `tools/operator-desktop/HighAsCG-Launcher.command` |
| **Windows** | `tools/operator-desktop/HighAsCG-Launcher.cmd` |

The Electron launcher displays **Flashing Guides**, **Partitioning & exFAT** guides, **Simulation Center**, and an **embedded control UI** (`dist-web/`) that talks to the headless API on the playout host (or local sim). Run `npm run launcher:prepare` once before first use.

- **macOS / Windows:** runs **`highascg-operator.js prepare-stick`** (sudo / Administrator).


## CLI (no GUI)

- **Node.js ≥ 20** (simulation + Mac/Win prepare).
- **macOS:** `sudo`, `dd`, `diskutil`, `tar`, `ditto`.
- **Windows:** **Administrator** PowerShell, built-in **`tar.exe`** (Windows 10+), for **`--tar-gz`**.

## Commands

From the **HighAsCG repo root** (same layout as a `.tar.gz` release after extract):

```bash
# Help
node tools/operator-desktop/highascg-operator.js --help

# Prepare USB: ISO + HIGHASCGEXF + extract release tarball into sim/highascg
npm run operator-kit -- prepare-stick --iso ~/Downloads/highascg_amd64_....iso --tar-gz ~/Downloads/highascg_....tar.gz

# Same, but copy an already-unpacked tree (must contain package.json)
npm run operator-kit -- prepare-stick --iso ... --app-dir ~/src/highascg

# Simulation (same as npm run portable:sim)
npm run operator-kit -- sim
npm run operator-kit -- sim --use-cwd
```

The **`prepare-stick`** subcommand runs:

- **macOS:** `sudo bash tools/live-usb/macos/make-highascg-stick.sh …`
- **Windows:** elevated `make-highascg-stick.ps1`

You still pick the USB device and confirm wipes in those scripts.

## Under the hood

| Piece | Role |
|-------|------|
| `client/tools/electron-launcher/` | Premium Electron Launcher & Simulation Center |
| `highascg-operator.js` | Parses args, invokes platform stick script or sim launcher |
| `tools/live-usb/macos/make-highascg-stick.sh` | `dd` ISO, `diskutil` exFAT, optional `--tar-gz` / `--app-dir` |
| `tools/live-usb/windows/make-highascg-stick.ps1` | Raw ISO write + `diskpart` exFAT, optional `-TarGzPath` / `-AppSourceDirectory` |
| `tools/portable-desktop/launch-sim-from-exfat.js` | WO‑50 simulation from `HIGHASCGEXF/sim/highascg` or `--use-cwd` |

GUI / manual path: embedded guides in **`npm run launcher`**, or [`../live-usb/USB_STICK_AFTER_FLASH.md`](../live-usb/USB_STICK_AFTER_FLASH.md) (Etcher + exFAT + server drop + launcher releases).

## Environment

| Variable | Meaning |
|----------|---------|
| `HIGHASCG_MAC_SH` | Override path to mac stick script |
| `HIGHASCG_PS1_PATH` | Override path to Windows PowerShell stick script |
