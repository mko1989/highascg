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
| GET | `/api/system/v4l2-devices` | V4L2 capture devices (`?refresh=1`) |
| GET | `/api/v4l2-inputs` | USB video input config + bridge status |
| POST | `/api/v4l2-inputs/config` | Persist V4L2 slot settings |
| POST | `/api/v4l2-inputs/apply` | Start bridges + PLAY on host channels |
| GET | `/api/virtual-camera` | Virtual cam config + runtime status |
| GET | `/api/virtual-camera/status` | Alias |
| POST | `/api/virtual-camera/config` | Persist virtual cam settings |
| POST | `/api/virtual-camera/start` | Start v4l2loopback bridge (+ optional ALSA mic) |
| POST | `/api/virtual-camera/stop` | Stop bridge |
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
| GET | `/api/system/setup` | Setup wizard state (includes compact `tailscale` block) |
| POST | `/api/system/setup/restart-window-manager` | nodm restart (password) |
| POST | `/api/system/setup/restart-app` | Restart HighAsCG Node process |
| POST | `/api/system/setup/reboot` | Reboot host (password) |
| POST | `/api/system/setup/install` | Launch Calamares installer — see [Calamares install guide](../../CALAMARES_INSTALL_TO_DISK.md) |
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
| GET | `/api/support/bundle` | Download diagnostics ZIP (configs, logs, GPU/xrandr, network) |
| POST | `/api/support/bundle` | Same; optional JSON `{ "operatorNote": "…" }` |
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

### Server logs (`GET /api/logs`)

HighAsCG in-memory log buffer (also streamed live on WebSocket `log_line`). Filter by category and level:

```bash
curl -s 'http://127.0.0.1:4200/api/logs?lines=200&categories=artnet,os-display&levels=warn,error&caspar=0'
```

Categories include `system`, `config`, `os-display`, `amcp`, `playback`, `streaming`, `audio`, `network`, `artnet`, `replication`, `websocket`, `device`, `sync`, `debug`. Open the **connection eye** in the Web UI for a live view with category dropdown and level checkboxes.

### Support bundle (`GET /api/support/bundle`)

One ZIP for post-mortems and bug reports — redacted settings, Caspar XML, project summary, system inventory, network, GPU/xrandr layout, log tails, host stats. Filename pattern: `highascg-support_<hostname>_<ISO-timestamp>.zip`. Max size defaults to 25 MB (`HIGHASCG_SUPPORT_BUNDLE_MAX_BYTES`). Sensitive config keys (token, password, secret, …) are replaced with `[REDACTED]`; see `manifest.json` → `redactedKeyPatterns`.

```bash
curl -s -o support.zip 'http://127.0.0.1:4200/api/support/bundle?logLines=2000&casparLines=500'
unzip -l support.zip
```

Same bundle as the **Support bundle** button in the connection-eye logs modal, or **Settings → Diagnostics**. Use after a failure or before contacting support.

## Host live sources & CEF interactive

**Caspar:** optional for focus/targets; required for mouse/keyboard/eval.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/host-live/operator-fullscreen` | Operator fullscreen video route state |
| POST | `/api/host-live/operator-fullscreen` | Toggle fullscreen route (`{ sourceId, action }`) |
| GET | `/api/host-live/migration` | Preview legacy NDI/browser migration |
| POST | `/api/host-live/migration` | Apply migration (`{ migrateHostLiveSources: true }`) |
| GET | `/api/cef-interactive/targets` | Focusable webpage hosts + CDP attach status |
| POST | `/api/cef-interactive/focus` | Bind CDP focus (`{ sourceId, zoneId? }`) |
| DELETE | `/api/cef-interactive/focus` | Clear CDP focus (host channel keeps playing) |
| POST | `/api/cef-interactive/mouse` | `{ sourceId?, type, x, y, button?, coordsNormalized? }` |
| POST | `/api/cef-interactive/keyboard` | `{ sourceId?, type, keysym?, text?, key?, modifiers? }` |
| POST | `/api/cef-interactive/eval` | `{ sourceId?, expression }` — evaluate JS in CEF page |

```bash
curl -s http://127.0.0.1:4200/api/cef-interactive/targets | jq .
curl -s -X POST http://127.0.0.1:4200/api/cef-interactive/focus \
  -H 'Content-Type: application/json' \
  -d '{"sourceId":"webpage_slido"}'
curl -s -X POST http://127.0.0.1:4200/api/cef-interactive/mouse \
  -H 'Content-Type: application/json' \
  -d '{"type":"mousedown","x":0.5,"y":0.5,"coordsNormalized":true}'
```

Requires `operatorTools.cefInteractiveBridge: true` and `remote-debugging-port` in `casparcg.config`. Operator fullscreen (WO-88) sets `cefFocusTarget` automatically; the focus API is for automation and Web UI without X11.

## Tailscale

**Caspar:** not required.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/network/tailscale/status` | Status + `config/tailscale.json` |
| POST | `/api/network/tailscale/enable` | `{ enabled: boolean }` |
| POST | `/api/network/tailscale/login` | Start interactive login |
| POST | `/api/network/tailscale/login-operator-ui` | Login + Firefox on operator `:0` |
| POST | `/api/network/tailscale/prefs` | Save tailscale preferences |
| POST | `/api/network/tailscale/logout` | Log out of tailnet |

Full request/response examples: [**network-tailscale.md**](network-tailscale.md).

---

```bash
curl -s 'http://127.0.0.1:4200/api/logs?lines=100&source=highascg' | jq .
```
