# System, settings & hardware

## Settings

**Caspar:** not required.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Full settings JSON |
| POST | `/api/settings` | Persist settings |
| POST | `/api/settings/apply-os` | Apply OS-related settings (GPU, etc.) |

```bash
curl -s http://127.0.0.1:4200/api/settings | jq .caspar.host
```

## Config (HighAsCG app config)

| Method | Path |
|--------|------|
| POST | `/api/config/apply` |
| POST | `/api/config/reset` |

## Caspar XML config

| Method | Path |
|--------|------|
| GET | `/api/caspar-config/generate` |
| GET | `/api/caspar-config/mode-choices` |
| GET | `/api/caspar-config/override` |
| POST | `/api/caspar-config/apply` |
| POST | `/api/caspar-config/override` |

## GPU & hardware

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/hardware/displays` | Display names (xrandr) |
| GET | `/api/hardware/modeline-preview` | Modeline preview |
| GET | `/api/system/gpu-nvidia` | NVIDIA probe |
| GET | `/api/system/gpu-layout` | GPU port layout |
| GET | `/api/system/decklink` | Decklink status |
| POST | `/api/system/gpu-nvidia/apply` | Apply NVIDIA layout |
| POST | `/api/system/gpu-ports-reset` | Reset port mapping |
| POST | `/api/system/gui-launch` | Launch GUI helper |

## Device view & snapshot

| Method | Path |
|--------|------|
| GET | `/api/device-view` |
| GET | `/api/device-view/gpu-map-debug` |
| POST | `/api/device-view` |
| GET | `/api/device-snapshot/schema` |
| GET | `/api/device-snapshot/build` |
| POST | `/api/device-snapshot/apply` |

## System setup & Caspar staging

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/system/setup` | Setup wizard state |
| POST | `/api/system/setup/restart-window-manager` | nodm restart (password) |
| POST | `/api/system/setup/restart-app` | Restart HighAsCG Node process |
| POST | `/api/system/setup/reboot` | Reboot host (password) |
| POST | `/api/system/setup/install` | Launch Calamares installer |
| GET | `/api/system/caspar-arm` | Staged Caspar armed? |
| POST | `/api/system/caspar-arm` | Arm Caspar start |
| DELETE | `/api/system/caspar-arm` | Disarm |

## exFAT sync · logs · stats

| Method | Path |
|--------|------|
| GET | `/api/system/exfat-sync` |
| POST | `/api/system/exfat-sync/run` |
| GET | `/api/logs` |
| POST | `/api/logs/clear` |
| GET | `/api/host-stats` |

**Caspar:** not required.

### exFAT sync dashboard (`GET /api/system/exfat-sync`)

Returns the installed sync map (`/etc/highascg/exfat-sync.json` or repo `config/exfat-sync.json`) with per-pair mount status, paths, and existence flags. Useful before/after inserting the operator USB stick or bridge disk.

```bash
curl -s http://127.0.0.1:4200/api/system/exfat-sync | jq '.volumes, .pairs[] | select(.id | test("project"))'
```

Key pairs (see [BRIDGE_DISK_AND_USB_EXFAT.md](../../BRIDGE_DISK_AND_USB_EXFAT.md)):

| Pair id | Volume | Direction | Role |
|---------|--------|-----------|------|
| `bridge-modular-config` | bridge | both | `configs/` ↔ `~/highascg/config/` |
| `usb-modular-config` | usb | to_project | Stick configs → host at boot |
| `usb-media-ingest` | usb | to_project | `media/` → `~/highascg/media/bridge` (one-way) |
| `bridge-projects` | bridge | both | `projects/` ↔ `~/highascg/projects/` (mtime sync) |
| `usb-projects` | usb | to_project | Stick `projects/` → working dir at boot only |

**Project saves** use a separate code path (`project-volume-sync.js`): each `POST /api/project/save` pushes **only the saved slug** to mounted USB/bridge volumes. The `usb-projects` pair does **not** use `pushOnSave` — stick catalog updates happen on explicit project save, not on Settings save.

### Run sync (`POST /api/system/exfat-sync/run`)

Preview (no writes):

```bash
curl -s -X POST http://127.0.0.1:4200/api/system/exfat-sync/run \
  -H 'Content-Type: application/json' \
  -d '{"dryRun": true}' | jq .
```

Commit mtime sync (overwrites older side per pair direction):

```bash
curl -s -X POST http://127.0.0.1:4200/api/system/exfat-sync/run \
  -H 'Content-Type: application/json' \
  -d '{"dryRun": false, "confirm": "EXFAT_SYNC"}' | jq .
```

**400** without `dryRun: true` or `confirm: "EXFAT_SYNC"`.

Implementation: [`src/api/routes-exfat-sync.js`](../../../src/api/routes-exfat-sync.js) · [`src/system/exfat-sync.js`](../../../src/system/exfat-sync.js)

---

```bash
curl -s 'http://127.0.0.1:4200/api/logs?lines=100&source=highascg' | jq .
```
