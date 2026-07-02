# HighAsCG security model

## Overview

HighAsCG exposes an HTTP API and operator WebSocket on the playout server. By default **authentication is not enforced** so existing deployments keep working. When enforcement is enabled, every `/api/*` route (except the auth bootstrap endpoints) and the operator WebSocket require a valid API token.

## Enabling API authentication

Set either:

- Environment: `HIGHASCG_ENFORCE_AUTH=1`
- Config: `security.enforceAuth: true` in `highascg.config.json` or modular `config/general.json`

On first boot with enforcement enabled, the server generates a random token in `.private/api-token` (mode `0600`) and logs a warning with recovery instructions.

Print the token on the box:

```bash
bash tools/runtime/print-api-token.sh
```

## Operator login (browser UI)

1. Open the UI on the same host/port as the server (same-origin).
2. If auth is enforced and you are not logged in, a sign-in overlay appears.
3. Paste the API token; the server sets an `HttpOnly; SameSite=Strict` session cookie.
4. Subsequent API calls and WebSocket upgrades use the cookie automatically.

For scripts and automation, send `Authorization: Bearer <token>` on HTTP requests. WebSocket upgrades accept the same token via `?token=` query param.

## Network exposure

| Setting | Effect |
|--------|--------|
| `security.enforceAuth: false` (default) | Legacy behaviour: binds `0.0.0.0` unless overridden |
| `security.enforceAuth: true` + `exposeToNetwork: false` | Binds `127.0.0.1` only |
| `security.enforceAuth: true` + `exposeToNetwork: true` | LAN bind allowed when a token is configured |

Refusing to bind `0.0.0.0` without a token prevents accidental open control planes.

## CORS and cross-origin access

With auth enforcement, CORS no longer uses `Access-Control-Allow-Origin: *`. Allowed origins are:

- Same host as the request (`Origin` matches `Host`)
- Extra origins in `HIGHASCG_CORS_ORIGINS` (comma-separated)

Cross-site browser pages cannot drive the API when cookies are `SameSite=Strict`.

## Secrets in API responses

`GET /api/settings` runs sensitive fields through redaction (`nuclearPassword`, `apiToken`, keys matching `*password*` / `*token*` / `*secret*`).

## TLS / reverse proxy

HighAsCG does not terminate TLS in-process. Put nginx, Caddy, or Tailscale Serve in front for HTTPS. Set `Secure` on session cookies when the proxy sends `X-Forwarded-Proto: https`.

## Recovery

If locked out:

1. SSH to the playout box.
2. Run `bash tools/runtime/print-api-token.sh`.
3. Log in locally or pass `Authorization: Bearer …` to API clients.

To disable enforcement temporarily: unset `HIGHASCG_ENFORCE_AUTH` and set `security.enforceAuth: false`, then restart.

## Production ISO / eggs sticks

`prepare-eggs-clone-with-exfat.sh` installs `highascg.service.d/25-api-auth.conf` (`HIGHASCG_ENFORCE_AUTH=1`) unless `HIGHASCG_EGG_ENFORCE_AUTH=0`. Factory modular config from `write-iso-default-config.js` sets `security.enforceAuth: true` and `exposeToNetwork: true`.

Each stick generates a **unique** token on first `highascg` start (`ensureApiToken`). Operators recover it with `print-api-token.sh` on the box.

## Related work

- WO-96: API/WS authentication (this document)
- WO-97: Zip-Slip-safe ingest extraction (`src/utils/safe-unzip.js`)
