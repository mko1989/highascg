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

### Logs query

```bash
curl -s 'http://127.0.0.1:4200/api/logs?lines=100&source=highascg' | jq .
```
