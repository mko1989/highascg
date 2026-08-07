# HighAsCG HTTP API

HighAsCG exposes a **JSON REST API** on the playout server. The operator UI (served from **`dist-web/`** on the same host at `:4200`) and Companion modules call these endpoints over HTTP; live state also flows over **WebSocket** on the same port.

## Base URL

```text
http://<playout-host>:4200/api/...
```

| Setting | Default | Override |
|---------|---------|----------|
| HTTP port | `4200` | `HTTP_PORT`, `PORT`, or `node index.js --port` |
| Bind | `0.0.0.0` | `BIND_ADDRESS`, `--bind` |
| Caspar AMCP | `127.0.0.1:5250` | `CASPAR_HOST`, `CASPAR_PORT` |

### Instance prefix

When the server is mounted under a path prefix (multi-instance dev), routes also work as:

```text
http://host:4200/instance/<id>/api/...
```

The router strips `/instance/<id>/` before dispatch.

## Request format

| Header | Value |
|--------|--------|
| `Content-Type` | `application/json` for POST/PUT bodies |
| Body | JSON object (empty `{}` allowed) |

Query parameters are used on some GET routes (e.g. mixer reads, thumbnails).

## Response format

Successful responses use **`application/json`**. Typical shapes:

```json
{ "ok": true }
```

```json
{ "data": "…", "playbackMatrix": { } }
```

Errors:

```json
{ "error": "human-readable message" }
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request / validation |
| `404` | Unknown route or resource |
| `410` | Removed API (e.g. legacy `/api/data/*`) |
| `502` | Upstream/Caspar command failed |
| `503` | **Caspar not connected** (see below) |

## Caspar connection gate

Most playout routes require an active AMCP connection to CasparCG. If Caspar is down or the server was started with `--no-caspar`, those routes return:

```http
HTTP/1.1 503 Service Unavailable
```

```json
{ "error": "Caspar not connected" }
```

**Works without Caspar** (non-exhaustive): settings, hardware displays, audio device list, streams status, streaming toggle, OSC, ingest/USB, project save/load on disk, logs, host stats, exFAT sync, system/GPU helpers, optional modules that do not call AMCP.

Implementation: [`src/api/router.js`](../../../src/api/router.js) — routes registered before the gate are documented per page with **Caspar: optional** where applicable.

## WebSocket

Same host/port as HTTP (default **4200**). Clients subscribe for:

- Aggregated **state** (channels, playback, OSC, etc.)
- **Scene live** updates
- Optional periodic broadcast (`HIGHASCG_WS_BROADCAST_MS`)

WebSocket message shapes are not duplicated here; see [osc-integration.md](../../osc-integration.md) and client `lib/ws-client.js` in this repo.

## OpenAPI file

[`openapi.yaml`](openapi.yaml) lists all paths for tooling; **scene take**, **playback**, **timelines**, **mixer**, **CG**, **project**, and **state/media** routes include schemas and examples. Narrative docs with **curl** and **fetch** examples live in the topic pages linked from [../README.md](../README.md).

| Endpoint group | Detailed doc |
|----------------|--------------|
| Scene take | [scene-take.md](scene-take.md) |
| Playback | [playback.md](playback.md) |
| Timelines | [timelines.md](timelines.md) |
| Mixer | [mixer.md](mixer.md) |
| CG | [cg.md](cg.md) |
| Project | [project.md](project.md) |
| State & media | [state-and-media.md](state-and-media.md) |
| Tailscale | [network-tailscale.md](network-tailscale.md) |

## Quick example

```bash
# Server health / config snapshot (needs Caspar for full channel list)
curl -s http://127.0.0.1:4200/api/state | jq .

# Settings (no Caspar required)
curl -s http://127.0.0.1:4200/api/settings | jq .

# Play a clip on channel 1, layer 10
curl -s -X POST http://127.0.0.1:4200/api/play \
  -H 'Content-Type: application/json' \
  -d '{"channel":1,"layer":10,"clip":"AMB","loop":true}'
```

## Source of truth

Route dispatch: [`src/api/router.js`](../../../src/api/router.js). Per-area handlers: `src/api/routes-*.js`. Optional modules register extra prefixes via [`src/module-registry.js`](../../../src/module-registry.js).
