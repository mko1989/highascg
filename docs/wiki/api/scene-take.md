# `POST /api/scene/take` — scene / look take

Takes a **look** (scene JSON with layers) to **program** or **preview** on Caspar, using the LBG pipeline (`runSceneTakeLbg`). This is the main air chain used by the scenes editor and Companion.

**Caspar:** required (`503` if AMCP is down).

**Implementation:** [`src/api/routes-scene.js`](../../../src/api/routes-scene.js) · AMCP order: [`docs/reference/amcp-pgm-look-take-pipeline.md`](../../reference/amcp-pgm-look-take-pipeline.md)

---

## Endpoint

```http
POST /api/scene/take
Content-Type: application/json
```

Default base: `http://127.0.0.1:4200/api/scene/take`

---

## Behaviour summary

| Mode | How to request | What happens |
|------|----------------|--------------|
| **Program take** | `channel` = PGM (e.g. `1`), omit `target` | Incoming look airs on PGM; previous PGM look moves to PRV (when routing has a preview bus) |
| **Preview-only** | `target`: `"preview"`, `"prv"`, or `"bus1"` | Incoming look built on PRV only (hard cut); PGM unchanged |
| **Direct program** | PGM channel not in `programChannels` map | Take runs on requested `channel` only (no PGM↔PRV exchange) |
| **Timeline-only look** | Every content layer has `source.type === "timeline"` | Delegates to timeline engine (not LBG bank swap) |

Takes on the **same `channel` are serialized** (`_sceneTakeChainByChannel`) so rapid UI clicks queue instead of racing AMCP.

**Timeout:** 120 seconds → `504` with `{ "error": "Scene take timed out" }`.

On success, server updates **live scene state**, broadcasts WebSocket `sceneLive`, and returns **`playbackMatrix`**.

---

## Request body

### Required

| Field | Type | Description |
|-------|------|-------------|
| `channel` | number | Caspar **program** channel for this take (e.g. `1`). Must be ≥ 1. |
| `incomingScene` | object | Full look/scene JSON, including **`layers` array** with at least one layer that has content. |

A layer has content when `layer.source.value` is non-empty (`layerHasContent`).

### `incomingScene` shape

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Look/scene id (stored in live state after take) |
| `name` | string | Display name (logging) |
| `mainScope` | string | Screen scope (`"0"`, `"1"`, `"all"`, …) |
| `layers` | array | Layer objects (see below) |
| `defaultTransition` | object | Optional global transition when per-layer transition omitted |

### Layer object (typical)

| Field | Type | Description |
|-------|------|-------------|
| `layerNumber` | number | Logical layer (e.g. `10` → Caspar `1-10` / `1-110` bank pair) |
| `source` | object | `{ "type": "media" \| "route" \| "timeline" \| …, "value": "clip.mov" \| route string \| timeline id }` |
| `transition` | object | Optional `{ "type": "MIX", "duration": 25, "tween": "linear" }` (frames at channel fps) |
| `loop` | boolean | Loop media (when applicable) |
| `opacity`, `fill`, … | various | Mixer/geometry — passed through to AMCP pipeline |
| `playSeekFrames` | number | Optional seek frame for timeline sync (stripped from persisted live state) |

**Alternative to full `incomingScene`:** provide `sceneId` (or `lookId` / `incomingSceneId`) and the server resolves the scene from the loaded project:

```json
{
  "channel": 1,
  "sceneId": "sc_1778329614472_gbdse4w"
}
```

If the id is missing from the project, you still get `incomingScene object required`.

### Optional control fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `target` / `bus` | string | — | `"preview"`, `"prv"`, or `"bus1"` → preview-only path |
| `forceCut` | boolean | `false` | Skip crossfade; cut take |
| `framerate` | number | from Caspar INFO | Override fps for mixer tween duration |
| `useServerLive` | boolean | `true` | When `false` and `currentScene` sent, use client’s `currentScene` instead of server live JSON |
| `currentScene` | object | server live | Outgoing look (with `useServerLive: false`) |
| `stageOnPreview` | boolean | `true` | PGM/PRV: stage incoming on PRV before PGM mix |

---

## Response

### `200 OK`

```json
{
  "ok": true,
  "sceneLive": {
    "1": { "sceneId": "sc_abc", "scene": { "id": "sc_abc", "name": "Look 1", "layers": [] } },
    "2": { "sceneId": "sc_prev", "scene": { } }
  },
  "playbackMatrix": { }
}
```

| Field | Description |
|-------|-------------|
| `ok` | Always `true` on success |
| `sceneLive` | Per-channel live look ids + stripped scene JSON (no ephemeral `playSeekFrames`) |
| `playbackMatrix` | Playback tracker snapshot (same family as `/api/play` responses) |

Clients should merge `sceneLive` into UI state; WebSocket also emits scene live updates.

### Error responses

| Status | Condition | Example body |
|--------|-----------|--------------|
| `400` | Missing/invalid `channel` | `{ "error": "channel required" }` |
| `400` | No `incomingScene` | `{ "error": "incomingScene object required …" }` |
| `400` | `layers` not an array | `{ "error": "incomingScene.layers must be an array" }` |
| `400` | No layer with `source.value` | `{ "error": "incomingScene has no layers with sources …" }` |
| `503` | Caspar not connected | `{ "error": "Caspar not connected" }` |
| `500` | AMCP/engine failure | `{ "error": "…" }` |
| `504` | Exceeded 120s | `{ "error": "Scene take timed out" }` |

---

## Examples

### Minimal program take (cut)

From [`tools/smoke/smoke-scene-take.js`](../../../tools/smoke/smoke-scene-take.js):

```bash
curl -s -X POST http://127.0.0.1:4200/api/scene/take \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": 1,
    "forceCut": true,
    "incomingScene": {
      "id": "sc_1778329614472_gbdse4w",
      "name": "Look 1",
      "layers": [
        {
          "layerNumber": 10,
          "source": { "type": "media", "value": "led-grid-3840x1024.png" }
        }
      ]
    }
  }'
```

### Program take with crossfade

```bash
curl -s -X POST http://127.0.0.1:4200/api/scene/take \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": 1,
    "framerate": 50,
    "incomingScene": {
      "id": "look_b",
      "name": "Look B",
      "defaultTransition": { "type": "MIX", "duration": 25, "tween": "easeInOutCubic" },
      "layers": [
        {
          "layerNumber": 10,
          "source": { "type": "media", "value": "clip.mov" },
          "transition": { "type": "MIX", "duration": 25, "tween": "linear" }
        }
      ]
    }
  }'
```

### Preview bus only (stage on PRV)

Uses routing: `channel` = PGM (`1`), preview on `switcherBus1Channels[0]` (often `2`).

```bash
curl -s -X POST http://127.0.0.1:4200/api/scene/take \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": 1,
    "target": "preview",
    "incomingScene": {
      "id": "look_prv",
      "layers": [
        { "layerNumber": 10, "source": { "type": "media", "value": "preview-still.png" } }
      ]
    }
  }'
```

### JavaScript (operator client)

```javascript
const res = await fetch(`${apiBase}/api/scene/take`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    channel: programChannel,
    incomingScene: sceneFromEditor,
    forceCut: false,
    framerate: programFps,
  }),
})
const data = await res.json()
if (!res.ok) throw new Error(data.error || res.statusText)
// data.sceneLive, data.playbackMatrix
```

---

## Routing (PGM / PRV)

Channel numbers come from persisted config (`channel_map` / routing). Typical 2-main layout:

| Role | Config field | Example Caspar ch |
|------|--------------|-------------------|
| PGM screen 1 | `programChannels[0]` or `programCh(1)` | `1` |
| PRV screen 1 | `switcherBus1Channels[0]` or `previewChannels[0]` | `2` |

`POST /api/scene/take` always passes **`channel` = PGM**. Preview path uses the mapped PRV channel internally.

Probe routing + live state:

```bash
curl -s http://127.0.0.1:4200/api/settings | jq '.channel_map // .routing'
curl -s http://127.0.0.1:4200/api/scene/live | jq .
```

---

## Related scene endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scene/live` | Current live scene per channel (no take) |
| POST | `/api/scene/border-lines` | Returns AMCP lines for global border CG (layer 998) |
| POST | `/api/scene/border-preset-crossfade` | Border crossfade between preset layers |

See [mixer-cg-scene.md](mixer-cg-scene.md) for FTB, LED test card, PiP.

---

## OpenAPI

Machine-readable schema for this operation: [`openapi.yaml`](openapi.yaml) → path `/api/scene/take`.
