# exFAT server updates (`drop-update/`)

For a **closed ISO** (no `src/` in squashfs), operators refresh the **Node server + operator UI** by dropping files on the stick — without reflashing the image.

**WO-52:** Server drops include **`dist-web/`** so stick updates refresh the browser UI on playout.

## Stick layout

| Path on `HIGHASCGEXF` | Purpose |
|------------------------|---------|
| **`drop-update/`** | Server drop — extract **`highascg-server_*.tar.gz`** here (must include **`dist-web/`** for UI) |
| `drop-update/applied/<UTC>/` | Optional audit copies (live USB **retain** mode); **consumed** drops on persistent installs |
| `drop-update/.applied-stamp` | Last successfully applied build stamp (retain mode) |
| `drop-config/` | Optional `highascg.config.json` (mtime sync) |
| `media/`, `templates/`, `configs/`, … | Operator data |

**Not on playout stick:** `sim/highascg/` (simulation from **Electron hub** on Mac/Windows), in-repo **`client/`** UI sources.

**Legacy:** `update/server/` is still applied once if present (log asks you to use `drop-update/`).

## Drop workflow

1. On a workstation, extract **`highascg-server_*.tar.gz`** from [`release:github-server`](DEV_RELEASE_GITHUB.md) into `drop-update/` on the exFAT volume (must include `package.json` and **`dist-web/index.html`** at the top of that folder).
2. Boot the live system (or reboot).
3. **`highascg-exfat-server-update.service`** runs **before** `highascg.service`:
   - Stops `highascg.service`
   - Validates drop (`package.json`, `src/`, **`dist-web/index.html`**, `tools/runtime/`)
   - `rsync` from `exfat/drop-update/` → `/home/casparcg/highascg/` (includes **`dist-web/`**; does not deploy **`client/`** sources)
   - Runs `npm ci --omit=dev` when `package-lock.json` is in the drop
   - **Live USB (retain):** leaves the drop in **`drop-update/`** — required on every cold boot because `~/highascg/` is not durable on the stick image
   - **Persistent install (consume):** moves the drop to `drop-update/applied/<UTC>/` after success
   - Starts `highascg.service`

## What the server tarball contains

| Included | Excluded |
|----------|----------|
| `index.js`, `src/`, `config/`, `template/`, `scripts/`, **`dist-web/`** | **`client/`** (sources only) |
| **`tools/runtime/`** only | `tools/smoke/`, `tools/eggs/`, `tools/release/` |

## Operator UI

Open **`http://<playout-ip>:4200/`** on the playout machine or LAN after deploy. Same origin — no separate client install on playout.

Optional **Electron launcher** on Mac/Windows ([**highascg-client**](https://github.com/mko1989/highascg-client)) — simulator, multiserver, modules packaging from `client/tools/electron-launcher/`; opens the system browser to playout `:4200`. Operator UI is **`client/`** → `dist-web/` in this repo.

## Disable / test

| Knob | Effect |
|------|--------|
| `/etc/highascg/disable-exfat-server-update` | Skip apply |
| `/etc/highascg/server-update-retain-drop` | Force **retain** (installed on live-USB images) |
| `/etc/highascg/server-update-consume-drop` | Force **consume** (move to `applied/`) |
| `HIGHASCG_SERVER_UPDATE_RETAIN_DROP=1` | Force retain |
| `HIGHASCG_SERVER_UPDATE_RETAIN_DROP=0` | Force consume |
| `HIGHASCG_SERVER_UPDATE_DRY_RUN=1` | Log only |
| `HIGHASCG_SERVER_UPDATE_NPM_CI=0` | Skip `npm ci` after rsync |
| `HIGHASCG_SERVER_UPDATE_ARCHIVE_COPY=1` | Retain mode: optional `cp -a` audit under `applied/` |

Manual run (root): `/usr/local/lib/highascg/highascg-exfat-server-update.sh`  
Apply helper: `/usr/local/lib/highascg/highascg-apply-server-drop.sh`

## Boot order

```
exfat mount → server-update (drop-update/) → exfat-sync (drop-config/) → highascg.service
```

If the USB stick enumerates **after** `local-fs.target` (slow hub/port), **`highascg-exfat-arrive.service`** runs when udev sees `LABEL=HIGHASCGEXF`. Disable with `/etc/highascg/disable-exfat-arrive`.

See also: [`WO47_ISO_VS_EXFAT.md`](WO47_ISO_VS_EXFAT.md), [`from_client/AGENT_SERVER_CLIENT_MERGE.md`](../from_client/AGENT_SERVER_CLIENT_MERGE.md), [`tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md`](../tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md).
