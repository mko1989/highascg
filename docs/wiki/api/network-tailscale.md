# Tailscale network API

**Caspar:** not required.

Configure Tailscale from the Web UI (**Settings → Tailscale**) or these routes. Privileged POST actions use the same **nuclear password** gate as reboot/Calamares when `ui.nuclearRequirePassword` is enabled.

Implementation: [`src/network/tailscale-service.js`](../../../src/network/tailscale-service.js) · [`src/api/routes-network-tailscale.js`](../../../src/api/routes-network-tailscale.js) · config: [`config/tailscale.json`](../../../config/tailscale.json)

Operator guide: [reference/tailscale-integration.md](../../reference/tailscale-integration.md) · WO-91

---

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/network/tailscale/status` | Full status + persisted config |
| POST | `/api/network/tailscale/enable` | Start/stop `tailscaled` (`{ enabled: boolean }`) |
| POST | `/api/network/tailscale/login` | Start interactive login; returns `authUrl` when pending |
| POST | `/api/network/tailscale/login-operator-ui` | Login + open auth URL in Firefox on operator `:0` |
| POST | `/api/network/tailscale/prefs` | Save `config/tailscale.json` preferences |
| POST | `/api/network/tailscale/logout` | `tailscale logout` |

`GET /api/system/setup` includes a compact `tailscale` object from the same service (IPv4, `needsLogin`, `authUrl`, `backendState`, etc.).

---

## GET `/api/network/tailscale/status`

```bash
curl -s http://127.0.0.1:4200/api/network/tailscale/status | jq .
```

**Response (example, connected):**

```json
{
  "installed": true,
  "cli": "/snap/bin/tailscale",
  "daemon": { "unit": "snap.tailscale.tailscaled.service", "state": "active" },
  "socketPath": null,
  "backendState": "Running",
  "authUrl": null,
  "ipv4": "100.87.189.107",
  "hostname": "highascg-nvidia-595",
  "dnsName": "highascg-nvidia-595.tailc30860.ts.net",
  "needsLogin": false,
  "connected": true,
  "statusLine": "highascg-nvidia-595  100.87.189.107",
  "adminUrl": "https://login.tailscale.com/admin/machines",
  "config": {
    "enabled": true,
    "autoLoginOnBoot": false,
    "hostname": "",
    "acceptRoutes": false,
    "operatorLoginAssist": true
  }
}
```

| Field | Meaning |
|-------|---------|
| `backendState` | Tailscale daemon state (`Running`, `NeedsLogin`, …) |
| `authUrl` | OAuth URL when login is required (also shown in Settings) |
| `connected` | `true` when `backendState` is `Running` and tailnet IPv4 is assigned |
| `config` | Persisted preferences from `config/tailscale.json` |

Status is read via Tailscale **Local API** (`/run/tailscale/tailscaled.sock`) when available, else `tailscale status --json`.

---

## POST `/api/network/tailscale/enable`

Body:

```json
{ "enabled": true, "password": "optional-nuclear-password" }
```

```bash
curl -s -X POST http://127.0.0.1:4200/api/network/tailscale/enable \
  -H 'Content-Type: application/json' \
  -d '{"enabled": true}'
```

Runs `systemctl enable --now tailscaled` and/or `systemctl start snap.tailscale.tailscaled.service` (whichever applies). Disable stops both unit names.

**502** if passwordless `sudo` is not configured for `systemctl`.

---

## POST `/api/network/tailscale/login`

Starts interactive login (`login-interactive` Local API or `sudo tailscale up` with config hostname/routes).

```bash
curl -s -X POST http://127.0.0.1:4200/api/network/tailscale/login \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**Response:**

```json
{
  "ok": true,
  "authUrl": "https://login.tailscale.com/a/…",
  "state": "NeedsLogin",
  "connected": false,
  "status": { }
}
```

Poll `GET …/status` every 3s until `connected` is true (Settings UI does this automatically for 120s).

---

## POST `/api/network/tailscale/login-operator-ui`

Same as login, then spawns Firefox on **`DISPLAY=:0`** with the server-generated auth URL (never pass arbitrary URLs from the client).

```bash
curl -s -X POST http://127.0.0.1:4200/api/network/tailscale/login-operator-ui \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**Response:**

```json
{
  "ok": true,
  "spawned": true,
  "authUrl": "https://login.tailscale.com/a/…",
  "bin": "/usr/local/lib/highascg/highascg-launch-operator-firefox.sh",
  "url": "https://login.tailscale.com/a/…"
}
```

Requires nodm/X on the operator monitor. Uses [`highascg-launch-operator-firefox.sh`](../../../tools/runtime/highascg-launch-operator-firefox.sh).

**409** when no auth URL is available yet — retry after `login` or wait and poll status.

---

## POST `/api/network/tailscale/prefs`

Persist advanced options (no systemd changes).

```json
{
  "autoLoginOnBoot": false,
  "acceptRoutes": false,
  "operatorLoginAssist": true,
  "hostname": "playout-box-1"
}
```

```bash
curl -s -X POST http://127.0.0.1:4200/api/network/tailscale/prefs \
  -H 'Content-Type: application/json' \
  -d '{"autoLoginOnBoot": true, "operatorLoginAssist": true}'
```

| Key | Default | Effect |
|-----|---------|--------|
| `autoLoginOnBoot` | `false` | ~4s after `highascg` start, trigger login if needed |
| `acceptRoutes` | `false` | Pass `--accept-routes` on `tailscale up` |
| `operatorLoginAssist` | `true` | Allow operator-monitor browser spawn |
| `hostname` | `""` | Optional `--hostname` for `tailscale up` |

---

## POST `/api/network/tailscale/logout`

```bash
curl -s -X POST http://127.0.0.1:4200/api/network/tailscale/logout \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Runs `sudo tailscale logout`. **502** without passwordless sudo.

---

## Sudo requirements

Documented in [HIGHASCG_PASSWORDLESS_SUDO.md](../../HIGHASCG_PASSWORDLESS_SUDO.md):

- `tailscale up`, `tailscale logout` (deb or snap path)
- `systemctl start|stop|enable --now tailscaled`
- `systemctl start|stop snap.tailscale.tailscaled.service`

---

## Related WO

Tailscale control shipped in [WO-91](../../../work/work-orders/91_WO_TAILSCALE_SETTINGS_AND_OPERATOR_UI.md). Broader **Network sync** tab (Syncthing, rsync) remains [WO-61](../../../work/work-orders/61_WO_RSYNC_PEER_SYNC_AND_NETWORK_SETTINGS.md).
