# Mixer API — `MIXER` AMCP over HTTP

CasparCG layer and channel mixer commands: opacity, fill, crop, color, audio volume, deferred tweens, and inspector effects.

**Caspar:** required (`503` if AMCP is down).

**Implementation:** [`src/api/routes-mixer.js`](../../../src/api/routes-mixer.js) · AMCP: [`src/caspar/amcp-mixer.js`](../../../src/caspar/amcp-mixer.js)

**AMCP table:** [`docs/reference/amcp-mapping.md`](../../reference/amcp-mapping.md)

CG, scene take, and PiP are separate: [mixer-cg-scene.md](mixer-cg-scene.md).

---

## Endpoints

```http
POST /api/mixer/{command}
GET  /api/mixer/{command}?channel=1&layer=10
```

| `{command}` | Layer required | Query (GET) | Set (POST) |
|-------------|----------------|-------------|------------|
| `opacity` | yes | current opacity | `opacity`, optional tween |
| `fill` | yes | FILL tuple | position/scale + optional `stretch` |
| `clip` | yes | CLIP tuple | `x`, `y`, `xScale`, `yScale` |
| `anchor` | yes | anchor | `x`, `y` |
| `crop` | yes | crop | `left`, `top`, `right`, `bottom` |
| `rotation` | yes | rotation | `degrees` |
| `blend` | yes | blend mode | `mode` (e.g. `normal`, `add`) |
| `keyer` | yes | keyer on/off | `keyer` `0` \| `1` |
| `chroma` | yes | chroma | Caspar chroma fields (see below) |
| `invert` | yes | invert | `invert` bool |
| `brightness` | yes | brightness | `value` |
| `saturation` | yes | saturation | `value` |
| `contrast` | yes | contrast | `value` |
| `levels` | yes | levels | `minInput`, `maxInput`, `gamma`, `minOutput`, `maxOutput` |
| `volume` | yes | volume | `volume` |
| `mastervolume` | channel only | master | `volume` |
| `straight_alpha` | channel only | straight alpha | `enable` bool |
| `grid` | channel only | grid | `resolution` |
| `commit` | channel only | — | applies deferred mixer |
| `clear` | optional layer | — | clear mixer state |
| `effect` | yes | — | inspector `effectType` + `params` |

**Not a top-level path:** `perspective` — use **`POST /api/mixer/effect`** with `effectType: "perspective"`.

---

## Common POST fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `channel` | number | `1` | Caspar channel |
| `layer` | number | — | Caspar layer (`channel-layer`) |
| `duration` | number | — | Tween length in **frames** |
| `tween` | string | — | Easing (`linear`, `easeInOutCubic`, …) |
| `defer` | boolean | — | Append `DEFER` — apply on `commit` |

### Deferred multi-change (looks / batches)

1. Send several mixer POSTs with `"defer": true`.
2. **`POST /api/mixer/commit`** with `{ "channel": 1 }`.

Do **not** wrap `MIXER … COMMIT` inside `/api/amcp/batch` `BEGIN`/`COMMIT` — send commit as its own line ([playback-and-amcp.md](playback-and-amcp.md)).

---

## UI selection integration

When the operator has a **look layer** selected (`POST /api/selection` with `context: "scene_layer"`), **`opacity`** and **`fill`** can omit `channel` / `layer`:

- Server reads `ui_selection_look_preview_channel` and `ui_selection_look_caspar_layer` from variables.
- Updates the matching layer in the persisted **web project** (debounced save).
- Broadcasts WebSocket `mixer_update` with `{ lookId, layerIdx, updatedValues }`.

**Relative nudges:** pass `"+0.01"` or `"-0.05"` for `opacity` or fill `x` / `y` / `scaleX` / `scaleY` — server applies delta from current project/UI state.

**Aspect lock:** when the look layer has `aspectLocked`, changing `scaleX` or `scaleY` adjusts the other axis to preserve aspect.

---

## Commands (detail)

### `POST /api/mixer/opacity`

```json
{
  "channel": 1,
  "layer": 10,
  "opacity": 0.5,
  "duration": 25,
  "tween": "linear",
  "defer": false
}
```

AMCP: `MIXER 1-10 OPACITY 0.5 25 linear`

### `POST /api/mixer/fill`

Normalized position and scale (0–1 style, Caspar FILL semantics):

```json
{
  "channel": 1,
  "layer": 10,
  "x": 0,
  "y": 0,
  "xScale": 1,
  "yScale": 1,
  "duration": 0
}
```

**Content-aware stretch** (queries layer `INFO` for width/height):

| `stretch` | Behaviour |
|-----------|-----------|
| `none` | Native scale; clip if larger than layer box |
| `fit` | Letterbox inside layer rect |
| `fill-h` | Full width, height by aspect |
| `fill-v` | Full height, width by aspect |
| `stretch` | Fill layer rect; resets clip to full frame |

Optional geometry hints: `channelW`, `channelH`, `layerW`, `layerH`, `layerX`, `layerY`.

### `POST /api/mixer/clip`

Mask rectangle (same tuple shape as FILL in AMCP):

```json
{
  "channel": 1,
  "layer": 10,
  "x": 0,
  "y": 0,
  "xScale": 0.5,
  "yScale": 0.5
}
```

Inspector **clip_mask** effect maps `params.left/top/width/height` → `x`, `y`, `xScale`, `yScale`.

### `POST /api/mixer/crop`

```json
{
  "channel": 1,
  "layer": 10,
  "left": 0,
  "top": 0,
  "right": 0,
  "bottom": 0
}
```

### `POST /api/mixer/levels`

```json
{
  "channel": 1,
  "layer": 10,
  "minInput": 0,
  "maxInput": 1,
  "gamma": 1,
  "minOutput": 0,
  "maxOutput": 1,
  "duration": 0,
  "defer": true
}
```

Inspector effect uses `minIn` / `maxIn` / `minOut` / `maxOut` aliases inside `effect` → mapped to `minInput` etc.

### `POST /api/mixer/chroma`

Pass Caspar chroma options on the body (forwarded to AMCP):

```json
{
  "channel": 1,
  "layer": 10,
  "enable": true,
  "targetHue": 120,
  "hueWidth": 0.1,
  "minSaturation": 0.3,
  "minBrightness": 0.2,
  "softness": 0.1,
  "spillSuppress": 0.5
}
```

### `POST /api/mixer/blend`

```json
{ "channel": 1, "layer": 10, "mode": "normal" }
```

### `POST /api/mixer/keyer`

Layer straight-alpha keyer (not DeckLink hardware key):

```json
{ "channel": 1, "layer": 10, "keyer": 1 }
```

### `POST /api/mixer/volume` · `POST /api/mixer/mastervolume`

```json
{ "channel": 1, "layer": 10, "volume": 1, "duration": 0 }
```

```json
{ "channel": 1, "volume": 0.8 }
```

### `POST /api/mixer/straight_alpha`

Channel output straight alpha:

```json
{ "channel": 1, "enable": true }
```

### `POST /api/mixer/grid`

Safe-area / grid overlay on channel:

```json
{ "channel": 1, "resolution": 1 }
```

### `POST /api/mixer/commit`

```json
{ "channel": 1 }
```

### `POST /api/mixer/clear`

Per layer or whole channel:

```json
{ "channel": 1, "layer": 10 }
```

```json
{ "channel": 1 }
```

---

## `POST /api/mixer/effect`

Single inspector effect (same types as the client effect registry):

```json
{
  "channel": 1,
  "layer": 10,
  "effectType": "brightness",
  "params": { "value": 1.2 },
  "duration": 25,
  "tween": "linear",
  "defer": true
}
```

| `effectType` | `params` (typical) | AMCP routed to |
|--------------|-------------------|----------------|
| `blend_mode` | `mode` | `blend` |
| `brightness` | `value` | `brightness` |
| `contrast` | `value` | `contrast` |
| `saturation` | `value` | `saturation` |
| `levels` | `minIn`, `maxIn`, `gamma`, `minOut`, `maxOut` | `levels` |
| `chroma_key` | `key`, `threshold`, `softness`, `spill`, `blur` | `chroma` |
| `crop` | `left`, `top`, `right`, `bottom` | `crop` |
| `clip_mask` | `left`, `top`, `width`, `height` | `clip` |
| `perspective` | `ulX`, `ulY`, `urX`, `urY`, `lrX`, `lrY`, `llX`, `llY` | `perspective` |
| `grid` | `resolution` | `grid` |
| `keyer` | `enabled` | `keyer` |
| `rotation` | `degrees` | `rotation` |
| `anchor` | `x`, `y` | `anchor` |

Alias: `type` instead of `effectType`.

**400** from handler: `{ "error": "Unknown inspector effectType: …" }`  
**502** / **503** from `handleMixerSafe` on AMCP/connection errors.

---

## GET — query current value

Omit value fields in POST; GET runs the AMCP query form (no arguments → read current state).

```bash
curl -s 'http://127.0.0.1:4200/api/mixer/opacity?channel=1&layer=10'
```

Typical response:

```json
{
  "ok": true,
  "data": "1"
}
```

`data` is the raw AMCP payload (often a string or string array).

---

## Examples

### Fade layer in over 1 second @ 50 fps

```bash
curl -s -X POST http://127.0.0.1:4200/api/mixer/opacity \
  -H 'Content-Type: application/json' \
  -d '{"channel":1,"layer":10,"opacity":1,"duration":50,"tween":"easeInOutCubic"}'
```

### Deferred look tweak + commit

```bash
curl -s -X POST http://127.0.0.1:4200/api/mixer/fill \
  -H 'Content-Type: application/json' \
  -d '{"channel":1,"layer":10,"x":0.1,"y":0,"xScale":0.8,"yScale":0.8,"defer":true}'

curl -s -X POST http://127.0.0.1:4200/api/mixer/opacity \
  -H 'Content-Type: application/json' \
  -d '{"channel":1,"layer":10,"opacity":1,"duration":25,"tween":"linear","defer":true}'

curl -s -X POST http://127.0.0.1:4200/api/mixer/commit \
  -H 'Content-Type: application/json' \
  -d '{"channel":1}'
```

### JavaScript

```javascript
await fetch(`${apiBase}/api/mixer/fill`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    channel: 1,
    layer: 10,
    x: 0,
    y: 0,
    xScale: 1,
    yScale: 1,
    stretch: 'fit',
    channelW: 1920,
    channelH: 1080,
  }),
})
```

---

## Responses and errors

| Status | Meaning |
|--------|---------|
| `200` | AMCP success — body is passthrough Caspar JSON (`ok`, `data`, …) |
| `400` | Unknown `{command}` |
| `502` | Caspar/command failure |
| `503` | Not connected / socket errors |

---

## Related

| Doc | Topic |
|-----|--------|
| [playback.md](playback.md) | `PLAY` / `LOAD` / layer transport |
| [scene-take.md](scene-take.md) | Look take applies mixer + LOADBG/PLAY |
| [timelines.md](timelines.md) | Keyframed mixer during timeline tick |
| [playback-and-amcp.md](playback-and-amcp.md) | Batch AMCP + `COMMIT` rules |

---

## OpenAPI

[`openapi.yaml`](openapi.yaml) — `MixerCommand` path param, `MixerCommonFields`, per-command request notes, examples for `opacity`, `fill`, `commit`, `effect`.
