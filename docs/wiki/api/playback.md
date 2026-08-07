# Playback API — PLAY, LOAD, LOADBG, transport

Layer-level CasparCG AMCP commands exposed as JSON POST routes. These are the **direct** playout controls (single channel/layer). Full **look takes** use [`POST /api/scene/take`](scene-take.md) instead.

**Caspar:** required (`503` if AMCP is down).

**Implementation:** [`src/api/routes-amcp.js`](../../../src/api/routes-amcp.js) · AMCP client: [`src/caspar/amcp-basic.js`](../../../src/caspar/amcp-basic.js) · Command builder: [`src/caspar/amcp-command-plan.js`](../../../src/caspar/amcp-command-plan.js)

**AMCP mapping table:** [`docs/reference/amcp-mapping.md`](../../reference/amcp-mapping.md)

For batched/raw AMCP, logging, restart, and diagnostics see [playback-and-amcp.md](playback-and-amcp.md#amcp-bridge).

---

## Base URL

```http
POST http://127.0.0.1:4200/api/<endpoint>
Content-Type: application/json
```

---

## Common request fields

Most layer commands accept:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `channel` | number | `1` | Caspar channel |
| `layer` | number | — | Caspar layer (`channel-layer`, e.g. `10` → `1-10`). Omit only where AMCP allows channel-only (e.g. `PRINT`) |

Clip commands (`play`, `load`, `loadbg`) add:

| Field | Type | Description |
|-------|------|-------------|
| `clip` | string | Media path, `route://…`, `ndi://…`, `[HTML] …`, or URL (see **Clip strings**) |
| `loop` | boolean | Append `LOOP` to AMCP |
| `transition` | string | `MIX`, `PUSH`, `WIPE`, `SLIDE`, `STING`, … (`CUT` omitted on wire) |
| `duration` | number | Transition length in **frames** |
| `tween` | string | Easing name (e.g. `linear`, `easeInOutCubic`) |
| `auto` | boolean | `AUTO` — background plays when foreground ends (`loadbg` / `play`) |
| `parameters` | string | Extra AMCP tokens (STING template path, etc.) |
| `audioFilter` | string | Raw FFmpeg `AF` filter string |
| `audioRoute` | string | Shorthand: `1+2` (default), `3+4`, `5+6`, … → mapped to `AF` |

---

## Responses

### With `playbackMatrix`

`POST /api/play`, `/api/stop`, `/api/clear`, and `/api/amcp/batch` return the AMCP result object **plus** a server-side tracker snapshot:

```json
{
  "data": "…",
  "playbackMatrix": {
    "1-10": {
      "channel": 1,
      "layer": 10,
      "clip": "AMB",
      "startedAt": 1717512345678,
      "durationMs": 120000,
      "playing": true,
      "loop": false,
      "isRoute": false
    }
  }
}
```

The tracker updates on **play** (records clip) and **stop/clear** (removes layer). OSC mode can also feed the matrix; see [`src/state/playback-tracker.js`](../../../src/state/playback-tracker.js).

WebSocket clients receive `playback.matrix` state changes when the matrix updates.

### Without `playbackMatrix`

`POST /api/load`, `/api/loadbg`, `/api/pause`, `/api/resume`, `/api/call`, `/api/swap`, `/api/add`, `/api/remove` return the raw AMCP JSON only (no matrix merge).

### Errors

| Status | When |
|--------|------|
| `400` | Missing `commands` on batch routes, missing `cmd` on `/api/raw`, etc. |
| `502` | Caspar rejected the command (upstream failure) |
| `503` | Caspar not connected |

---

## Side effects

| Endpoint | Playback tracker | Live scene broadcast |
|----------|------------------|----------------------|
| `play` | Records layer | May invalidate/broadcast if channel is a **program** channel |
| `stop`, `clear` | Clears layer | Same |
| `load`, `loadbg` | — | Same |
| Others | — | — |

Direct AMCP on a program channel can desync UI “live look” state from Caspar; the server broadcasts `sceneLive` when routing marks the channel as program.

---

## `POST /api/play`

Maps to **`PLAY <channel>-<layer> <clip> …`**.

### Request

```json
{
  "channel": 1,
  "layer": 10,
  "clip": "AMB",
  "loop": true,
  "transition": "MIX",
  "duration": 25,
  "tween": "linear"
}
```

**Empty clip:** `PLAY` with no clip string is valid (resume / transition on existing layer) — omit `clip` or use `""`.

### Example

```bash
curl -s -X POST http://127.0.0.1:4200/api/play \
  -H 'Content-Type: application/json' \
  -d '{"channel":1,"layer":10,"clip":"AMB","loop":true}'
```

```javascript
const res = await fetch(`${apiBase}/api/play`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ channel: 1, layer: 10, clip: 'AMB', loop: true }),
})
const data = await res.json()
// data.playbackMatrix
```

### AMCP examples (generated)

| Body | Approximate AMCP |
|------|------------------|
| `{ "channel":1, "layer":10, "clip":"AMB", "loop":true }` | `PLAY 1-10 AMB LOOP` |
| `{ "channel":1, "layer":10, "clip":"clip.mov", "transition":"MIX", "duration":25, "tween":"linear" }` | `PLAY 1-10 clip.mov MIX 25 linear` |
| `{ "channel":1, "layer":10, "clip":"[HTML] http://host/page", "audioRoute":"3+4" }` | `PLAY 1-10 [HTML] "http://host/page" AF …` |

---

## `POST /api/load`

Maps to **`LOAD`** — loads into **foreground** without necessarily starting playback (Caspar semantics).

Same clip/transition/audio fields as **play**, except **`auto`** is not passed from the HTTP handler.

```bash
curl -s -X POST http://127.0.0.1:4200/api/load \
  -H 'Content-Type: application/json' \
  -d '{"channel":1,"layer":10,"clip":"still.png","loop":true}'
```

Typical workflow: `load` or `loadbg` → `play` or `call` to air.

---

## `POST /api/loadbg`

Maps to **`LOADBG`** — loads into **background** stack for later `CALL` or mixed `PLAY`.

Supports **`auto`** (background auto-starts when foreground ends).

```bash
curl -s -X POST http://127.0.0.1:4200/api/loadbg \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": 1,
    "layer": 20,
    "clip": "next.mov",
    "transition": "MIX",
    "duration": 25,
    "tween": "easeInOutCubic",
    "auto": true
  }'
```

Then take background to air:

```bash
curl -s -X POST http://127.0.0.1:4200/api/call \
  -H 'Content-Type: application/json' \
  -d '{"channel":1,"layer":20}'
```

Or crossfade with play on the same layer after loadbg.

---

## `POST /api/pause` · `POST /api/resume`

Maps to **`PAUSE`** / **`RESUME`**.

```json
{ "channel": 1, "layer": 10 }
```

```bash
curl -s -X POST http://127.0.0.1:4200/api/pause \
  -H 'Content-Type: application/json' \
  -d '{"channel":1,"layer":10}'
```

---

## `POST /api/stop` · `POST /api/clear`

Maps to **`STOP`** / **`CLEAR`**.

Both update **`playbackMatrix`** (layer removed from tracker).

```bash
curl -s -X POST http://127.0.0.1:4200/api/stop \
  -H 'Content-Type: application/json' \
  -d '{"channel":1,"layer":10}'
```

`CLEAR` removes producers and mixer state on the layer (stronger than stop).

---

## `POST /api/call`

Maps to **`CALL <channel>-<layer> [function] [params]`** — brings background to foreground (Caspar CALL semantics).

| Field | Type | Description |
|-------|------|-------------|
| `fn` | string | Optional CALL function name |
| `params` | string | Optional parameter string appended to command |

```bash
curl -s -X POST http://127.0.0.1:4200/api/call \
  -H 'Content-Type: application/json' \
  -d '{"channel":1,"layer":20}'
```

---

## `POST /api/swap`

Maps to **`SWAP <ch1>-<layer1> <ch2>-<layer2> [TRANSFORMS]`**.

| Field | Type | Description |
|-------|------|-------------|
| `channel` | number | First channel (default `1`) |
| `layer` | number | First layer |
| `channel2` | number | Second channel |
| `layer2` | number | Second layer |
| `transforms` | boolean | Append `TRANSFORMS` when true |

```json
{
  "channel": 1,
  "layer": 10,
  "channel2": 1,
  "layer2": 20,
  "transforms": true
}
```

---

## `POST /api/add` · `POST /api/remove`

Channel **consumer** producers (outputs), not clip layers.

### `POST /api/add`

| Field | Type | Description |
|-------|------|-------------|
| `channel` | number | Caspar channel |
| `consumer` | string | Consumer type (e.g. `decklink`, `screen`) |
| `params` | string | Consumer parameter string |
| `index` | number | Optional `ADD <channel>-<index>` |

```json
{
  "channel": 1,
  "consumer": "decklink",
  "params": "device 1",
  "index": 0
}
```

### `POST /api/remove`

| Field | Type | Description |
|-------|------|-------------|
| `channel` | number | Caspar channel |
| `consumer` | string | Consumer id (when not using index) |
| `index` | number | `REMOVE <channel>-<index>` |

---

## Clip strings

| Form | Transport | Notes |
|------|-----------|--------|
| `clip.mov`, `media/still.png` | Usually **typed** `casparcg-connection` | Quoted if spaces |
| `[HTML] …` | **Raw** AMCP | Browser/HTML producer |
| `ndi://…` | **Raw** | NDI source |
| `route://1-10` | **Raw** | Routed layer |
| `http(s)://…` | Typed or `[HTML]` | Non-video extensions forced to HTML |

STING transitions require `transition: "STING"` and `parameters` with template path.

---

## WebSocket parity

Structured AMCP over WebSocket uses the same fields as HTTP bodies (`type: "play"`, `channel`, `layer`, `clip`, …). See smoke test `dispatchStructuredAmcp` in [`tools/smoke/highascg-health-api-amcp.test.js`](../../../tools/smoke/highascg-health-api-amcp.test.js).

---

## Related

| Doc | Content |
|-----|---------|
| [scene-take.md](scene-take.md) | Multi-layer look take (LOADBG/PLAY pipeline) |
| [playback-and-amcp.md](playback-and-amcp.md) | `/api/amcp/batch`, raw, print, restart, logs |
| [mixer-cg-scene.md](mixer-cg-scene.md) | `MIXER`, CG, FTB |
| [project-state-media.md](project-state-media.md) | `/api/state`, `/api/channels`, media list |

---

## OpenAPI

[`openapi.yaml`](openapi.yaml) — schemas `PlayRequest`, `LayerTransportRequest`, `PlaybackResponse`, `AmcpBatchRequest`.
