# Timelines API

Multi-track timelines with clip keyframes, playhead transport, and Caspar output on **layers 200+** (above look stacks 1–199). The server holds timelines in the **timeline engine** (in-memory); the operator UI syncs edits via `PUT` / `POST` before transport.

**Caspar:** all `/api/timelines/*` routes are registered **after** the AMCP gate — Caspar must be connected (`503` otherwise).

**Engine:** if `timelineEngine` is not initialized, every timeline route returns `503` `{ "error": "Timeline engine not ready" }`.

**Implementation:** [`src/api/routes-timeline.js`](../../../src/api/routes-timeline.js) · [`src/engine/timeline-engine.js`](../../../src/engine/timeline-engine.js) · AMCP sync: [`src/engine/timeline-playback-amcp.js`](../../../src/engine/timeline-playback-amcp.js)

**Related:** scene take with timeline-only looks → [`scene-take.md`](scene-take.md). Multiview / NDI → [timelines-multiview.md](timelines-multiview.md).

---

## Base URL

```http
http://127.0.0.1:4200/api/timelines
Content-Type: application/json
```

Path actions use **`POST /api/timelines/{id}/{action}`** (not separate top-level paths).

---

## Overview

| Concern | Detail |
|---------|--------|
| Storage | Server `TimelineEngine.timelines` map (lost on restart unless clients re-`PUT`) |
| Caspar layers | Layer index `i` → Caspar `200 + i` on each target channel |
| Routing | `sendTo`: `{ preview, program, screenIdx }` → PGM/PRV channels from `channel_map` |
| State | `GET /api/state` includes `timelines[]` and `timelinePlayback` |
| WebSocket | `timeline.playback`, throttled `timeline.tick` |

---

## Timeline document model

### Timeline object

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | auto `tl…` | Unique id |
| `name` | string | `"Timeline"` | Display name |
| `duration` | number | `30000` | Timeline length (ms) |
| `fps` | number | `25` | Timecode / frame math |
| `flags` | array | `[]` | Playhead markers (pause/play/jump/companion) |
| `layers` | array | 3 empty layers | Stack of timeline layers |

### Layer

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Layer id |
| `name` | string | e.g. `"Layer 1"` |
| `clips` | array | Clips on this track |

### Clip

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Clip id |
| `source` | object | `{ type, value, resolution? }` — media path, route, etc. |
| `startTime` | number | Start on timeline (ms) |
| `duration` | number | Clip length on timeline (ms) |
| `inPoint` | number | Media in-point (ms) |
| `outPoint` | number \| null | Media out-point |
| `keyframes` | array | `{ time, property, value, easing }` — local ms inside clip |
| `audioRoute` | string | `1+2`, `3+4`, … |
| `volume`, `muted` | various | Audio |
| `fillPx` | object | `{ x, y, w, h }` pixel rect on program canvas |
| `contentFit`, `aspectLocked` | various | Layout |
| `startBehaviour` | string | `beginning` \| `relativeToPrevious` (scene take sync) |
| `loop`, `loopAlways` | boolean | Loop playback |

### Flag (marker)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Flag id |
| `timeMs` | number | Position on timeline |
| `type` | string | `pause`, `play`, `jump`, `companion_press` |
| `jumpTimeMs` | number | Jump target (for `jump`) |
| `jumpFlagId` | string | Jump to another flag’s time |
| `companionPage`, `companionRow`, `companionColumn` | numbers | For `companion_press` |

---

## CRUD

### `GET /api/timelines`

Returns **array** of all timeline objects.

```bash
curl -s http://127.0.0.1:4200/api/timelines | jq .
```

### `POST /api/timelines`

- **No `id` or unknown id:** `create(body)` — new timeline returned.
- **`id` present and exists:** `update(id, body)` — replaces stored timeline.

```bash
curl -s -X POST http://127.0.0.1:4200/api/timelines \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Show open",
    "duration": 60000,
    "fps": 50,
    "layers": [
      {
        "id": "layer1",
        "name": "Layer 1",
        "clips": [
          {
            "id": "c1",
            "source": { "type": "media", "value": "opener.mov" },
            "startTime": 0,
            "duration": 10000
          }
        ]
      }
    ]
  }'
```

### `GET /api/timelines/{id}`

Single timeline or **`404`** `{ "error": "Not found" }`.

### `PUT /api/timelines/{id}`

Update existing id, or **create** with that id if missing (upsert).

```bash
curl -s -X PUT http://127.0.0.1:4200/api/timelines/tl_abc123 \
  -H 'Content-Type: application/json' \
  -d @timeline.json
```

Client sync pattern (editor): `PUT` first, `POST /api/timelines` fallback.

### `DELETE /api/timelines/{id}`

Stops playback if this timeline was active, removes from engine.

```json
{ "ok": true }
```

---

## Playback state

### `GET /api/timelines/{id}/state`

Current engine playback (any timeline id in path; returns global playback state):

```json
{
  "timelineId": "tl_abc123",
  "position": 4520,
  "playing": true,
  "loop": false,
  "sendTo": {
    "preview": true,
    "program": false,
    "screenIdx": 0
  }
}
```

`position` is computed live when `playing: true`.

Also available on **`GET /api/state`** as `timelinePlayback`.

---

## Transport actions

All are **`POST /api/timelines/{id}/<action>`**.

### `play`

Start or resume playback.

| Field | Type | Description |
|-------|------|-------------|
| `from` | number | Start position (ms); default resume position or `0` |
| `sendTo` | object | Optional — set routing before play (same shape as `sendto`) |

```bash
curl -s -X POST http://127.0.0.1:4200/api/timelines/tl_abc123/play \
  -H 'Content-Type: application/json' \
  -d '{
    "from": 0,
    "sendTo": { "preview": true, "program": false, "screenIdx": 0 }
  }'
```

Response: `{ "ok": true }`.

Applies active clips to Caspar on target channels (layers 200+). Ticker runs every **40 ms**; AMCP updates on clip changes / keyframe segments, not every tick.

### `pause`

Pauses ticker and Caspar layers on timeline stack.

### `stop`

Stops ticker, resets position to **0**, clears timeline Caspar layers (`_stopAll`).

### `seek`

| Field | Type | Required |
|-------|------|----------|
| `ms` | number | yes, `>= 0` |

```bash
curl -s -X POST http://127.0.0.1:4200/api/timelines/tl_abc123/seek \
  -H 'Content-Type: application/json' \
  -d '{"ms": 5000}'
```

**400** if `ms` missing or invalid: `{ "error": "ms required (number >= 0)" }`.

### `loop`

```json
{ "loop": true }
```

Sets loop flag for active playback of this timeline id.

### `sendto`

Update preview/program routing without starting transport.

```json
{
  "preview": true,
  "program": false,
  "screenIdx": 0
}
```

| `screenIdx` | Meaning |
|-------------|---------|
| `0`, `1`, … | Single main screen (0-based) |
| `null` | All screens (used internally when take uses `all`) |

Removes AMCP from channels dropped when toggling `sendTo` off.

---

## `POST /api/timelines/{id}/take`

Air timeline to **program** (and preview during staging): clears look stacks on PGM/PRV, then plays from current or resumed position.

| Field | Type | Description |
|-------|------|-------------|
| `screenIdx` | number \| `"all"` \| `null` | `0` = first screen; `"all"` or `null` = every `screenCount` screen |

**Per screen:** clears scene look layers **1–199** on program + preview channels, `MIXER COMMIT`, clears live scene state, then:

```javascript
eng.setSendTo({ preview: true, program: true, screenIdx })
eng.play(id, currentPosition)
liveSceneState.broadcastSceneLive(ctx)
```

```bash
curl -s -X POST http://127.0.0.1:4200/api/timelines/tl_abc123/take \
  -H 'Content-Type: application/json' \
  -d '{"screenIdx": 0}'
```

All screens:

```json
{ "screenIdx": "all" }
```

| Status | Condition |
|--------|-----------|
| `404` | Unknown timeline id |
| `503` | Caspar not connected (inside take handler) |

**Note:** The UI may send `transition`, `duration`, `tween` on take; the server handler **does not** use them today — take always uses the engine’s direct play path after stack clear.

---

## `sendTo` and channel mapping

Resolved in [`timeline-playback-amcp.js`](../../../src/engine/timeline-playback-amcp.js) `_channelsFor`:

- `preview: true` → `previewCh(screen)` or bus mapping
- `program: true` → `programCh(screen)`
- `screenIdx: null` → iterate all `screenCount` screens

Default when playback starts: `{ preview: true, program: false, screenIdx: 0 }`.

---

## Scene integration

| Path | Behaviour |
|------|-----------|
| Look layer `source.type === "timeline"` | [`POST /api/scene/take`](scene-take.md) runs timeline engine instead of LBG |
| Timeline-only look | All content layers reference the same timeline id |
| `startBehaviour` | `relativeToPrevious` — playhead frame passed as `playSeekFrames` on take |

Timeline ids in looks must exist on the server (`eng.get(tlId)`).

---

## WebSocket events

| Event | Payload |
|-------|---------|
| `timeline.playback` | Full `getPlayback()` snapshot on play/pause/stop/seek/sendto |
| `timeline.tick` | `{ timelineId, position }` ~165 ms while playing |

Clients extrapolate playhead between ticks.

---

## Examples (operator flow)

1. **Upload timeline JSON**

```bash
curl -s -X PUT http://127.0.0.1:4200/api/timelines/my_show \
  -H 'Content-Type: application/json' \
  -d @my_show_timeline.json
```

2. **Preview on PRV**

```bash
curl -s -X POST http://127.0.0.1:4200/api/timelines/my_show/play \
  -H 'Content-Type: application/json' \
  -d '{"from":0,"sendTo":{"preview":true,"program":false,"screenIdx":0}}'
```

3. **Take to PGM**

```bash
curl -s -X POST http://127.0.0.1:4200/api/timelines/my_show/take \
  -H 'Content-Type: application/json' \
  -d '{"screenIdx":0}'
```

4. **Poll position**

```bash
curl -s http://127.0.0.1:4200/api/timelines/my_show/state | jq .position
```

---

## OpenAPI

Machine-readable schemas: [`openapi.yaml`](openapi.yaml) — `Timeline`, `TimelinePlayback`, transport request bodies.
