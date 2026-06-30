# Tailscale integration (WO-91)

HighAsCG controls Tailscale from **Settings → Tailscale** and exposes HTTP APIs for status, login, and operator-monitor browser assist.

## Config

File: `config/tailscale.json`

| Key | Default | Meaning |
|-----|---------|---------|
| `enabled` | `true` | Start/stop `tailscaled` via systemd |
| `autoLoginOnBoot` | `false` | On `highascg` start, call login when node needs auth |
| `hostname` | `""` | Optional `--hostname` for `tailscale up` |
| `acceptRoutes` | `false` | Pass `--accept-routes` on login |
| `operatorLoginAssist` | `true` | Spawn Firefox on `DISPLAY=:0` with auth URL when logging in |

## API

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/network/tailscale/status` | Full status + config |
| POST | `/api/network/tailscale/enable` | `{ enabled: boolean }` |
| POST | `/api/network/tailscale/login` | Start interactive login |
| POST | `/api/network/tailscale/login-operator-ui` | Login + open auth URL on operator monitor |
| POST | `/api/network/tailscale/prefs` | Save config keys above |
| POST | `/api/network/tailscale/logout` | `tailscale logout` |

`GET /api/system/setup` includes a compact `tailscale` block from the same service.

Privileged POST routes use the **nuclear password** gate when `ui.nuclearRequirePassword` is enabled.

## Operator monitor login

1. Settings → **Log in** or **Open on operator monitor**
2. Server calls Tailscale Local API `login-interactive` or `sudo tailscale up`
3. Auth URL must match `https://login.tailscale.com/…` (server-generated only)
4. Firefox launches via `highascg-launch-operator-firefox.sh <url>` on `:0`

Requires nodm/X session on the operator head (WO-87 pointer confine compatible).

## Sudo (passwordless)

The `casparcg` user needs non-interactive sudo for:

- `systemctl start|stop|enable --now tailscaled`
- `systemctl start|stop snap.tailscale.tailscaled.service`
- `tailscale up`, `tailscale logout` (deb or snap path)

See `docs/HIGHASCG_PASSWORDLESS_SUDO.md`.

## Boot hook

~4s after `highascg` starts, `maybeAutoLoginOnBoot()` runs when `autoLoginOnBoot` is true.

## Related

- [WO-91](../../work/work-orders/91_WO_TAILSCALE_SETTINGS_AND_OPERATOR_UI.md)
- [WO-61](../../work/work-orders/61_WO_RSYNC_PEER_SYNC_AND_NETWORK_SETTINGS.md) — broader network sync (Syncthing/rsync)
