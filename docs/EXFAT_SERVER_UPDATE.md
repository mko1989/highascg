# exFAT server updates (`drop-update/`)

For a **closed ISO** (no `src/` in squashfs), operators refresh the **Node server** by dropping files on the stick — without reflashing the image.

## Stick layout

| Path on `HIGHASCGEXF` | Purpose |
|------------------------|---------|
| **`drop-update/`** | **Server-only** drop — extract **`highascg-server_*.tar.gz`** here |
| `drop-update/applied/<UTC>/` | Archived drops after successful apply |
| `drop-config/` | Optional `highascg.config.json` (mtime sync) |
| `media/`, `templates/`, `configs/`, … | Operator data |

**Not on playout stick:** `sim/highascg/` (removed — simulation runs from the **Electron launcher** on Mac/Windows), `client/`, `dist-web/`.

**Legacy:** `update/server/` is still applied once if present (log asks you to use `drop-update/`).

## Drop workflow

1. On a workstation, extract **`highascg-server_*.tar.gz`** from [`release:github-server`](DEV_RELEASE_GITHUB.md) into `drop-update/` on the exFAT volume (must include `package.json` at the top of that folder).
2. Boot the live system (or reboot).
3. **`highascg-exfat-server-update.service`** runs **before** `highascg.service`:
   - Stops `highascg.service`
   - `rsync` from `exfat/drop-update/` → `/home/casparcg/highascg/` (does **not** touch `client/` or `dist-web/`)
   - Runs `npm ci --omit=dev` when `package-lock.json` is in the drop
   - Moves the drop to `drop-update/applied/<UTC>/`
   - Starts `highascg.service`

## What the server tarball contains

| Included | Excluded |
|----------|----------|
| `index.js`, `src/`, `config/`, `template/`, `scripts/` | `client/`, `dist-web/` |
| **`tools/runtime/`** only (`exfat-sync-cli.js`, Caspar staged start) | `tools/smoke/`, `tools/eggs/`, `tools/release/` |

## Client / UI

Install the client on **Mac/Windows** from [**highascg-client**](https://github.com/mko1989/highascg-client) (`npm run release:github-client` or launcher). Point it at the playout host IP — no UI files on the stick.

## Disable / test

| Knob | Effect |
|------|--------|
| `/etc/highascg/disable-exfat-server-update` | Skip apply |
| `HIGHASCG_SERVER_UPDATE_DRY_RUN=1` | Log only |
| `HIGHASCG_SERVER_UPDATE_NPM_CI=0` | Skip `npm ci` after rsync |

Manual run (root): `/usr/local/lib/highascg/highascg-exfat-server-update.sh`

## Boot order

```
exfat mount → server-update (drop-update/) → exfat-sync (drop-config/) → highascg.service
```

If the USB stick enumerates **after** `local-fs.target` (slow hub/port), **`highascg-exfat-arrive.service`** runs when udev sees `LABEL=HIGHASCGEXF`. Disable with `/etc/highascg/disable-exfat-arrive`.

See also: [`WO47_ISO_VS_EXFAT.md`](WO47_ISO_VS_EXFAT.md), [`tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md`](../tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md).
