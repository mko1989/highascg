# Companion Inspector Layer Endpoints

This document defines the HTTP API surface for controlling **all layer parameters shown in the inspector**, including:

- base layer geometry/mixer/audio params,
- mixer effects,
- PIP overlays.

The goal is to let Companion (or any external controller) drive the same parameter model as the UI.

## Scope and model

- A layer can be controlled in two ways:
  - **Live mixer control** on a concrete `channel` + `layer`.
  - **Look model control** by sending full look JSON to `/api/scene/take` (`incomingScene.layers[*]`).
- Inspector parameters map to **existing mixer/pip endpoints** plus one convenience endpoint:
  - `POST /api/mixer/effect` (added for companion parity with inspector effects).

---

## 1) Base layer parameters (live)

### Geometry and transform

- **Fill / position / size / stretch**
  - `POST /api/mixer/fill`
  - Body:
    - `channel`, `layer`
    - `x`, `y`, `xScale`, `yScale`
    - optional: `stretch`, `layerX`, `layerY`, `layerW`, `layerH`, `channelW`, `channelH`
    - optional transition: `duration`, `tween`, `defer`

- **Clip mask (direct)**
  - `POST /api/mixer/clip`
  - Body: `channel`, `layer`, `x`, `y`, `xScale`, `yScale` (+ optional `duration`,`tween`,`defer`)

- **Anchor**
  - `POST /api/mixer/anchor`
  - Body: `channel`, `layer`, `x`, `y` (+ optional transition args)

- **Rotation**
  - `POST /api/mixer/rotation`
  - Body: `channel`, `layer`, `degrees` (+ optional transition args)

- **Opacity**
  - `POST /api/mixer/opacity`
  - Body: `channel`, `layer`, `opacity` (+ optional transition args)

- **Keyer**
  - `POST /api/mixer/keyer`
  - Body: `channel`, `layer`, `keyer` (`0|1`)

### Audio

- **Volume (layer)**
  - `POST /api/audio/volume`
  - Body: `channel`, `layer`, `volume`

### Commit / reset helpers

- **Commit deferred mixer ops**
  - `POST /api/mixer/commit`
  - Body: `channel`

- **Clear one layer mixer state**
  - `POST /api/mixer/clear`
  - Body: `channel`, `layer`

---

## 2) Mixer effects (inspector effects list)

All effect types are available through:

- `POST /api/mixer/effect`
- Body:
  - `channel`, `layer`
  - `effectType` (or `type`)
  - `params` (effect-specific)
  - optional transition args where meaningful: `duration`, `tween`, `defer`

### Supported `effectType` values and `params`

- `blend_mode`: `{ mode }`
- `brightness`: `{ value }`
- `contrast`: `{ value }`
- `saturation`: `{ value }`
- `levels`: `{ minIn, maxIn, gamma, minOut, maxOut }`
- `chroma_key`: `{ key, threshold, softness, spill, blur }`
- `crop`: `{ left, top, right, bottom }`
- `clip_mask`: `{ left, top, width, height }`
- `perspective`: `{ ulX, ulY, urX, urY, lrX, lrY, llX, llY }`
- `grid`: `{ resolution }`
- `keyer`: `{ enabled }`
- `rotation`: `{ degrees }`
- `anchor`: `{ x, y }`

Notes:

- `clip_mask` maps to Caspar `MIXER ... CLIP`.
- `keyer` effect accepts boolean `enabled`; route-level keyer endpoint accepts numeric `keyer`.

---

## 3) PIP overlays (including custom border-style params)

PIP overlay stack endpoints:

- `POST /api/pip-overlay/apply`
- `POST /api/pip-overlay/update`
- `POST /api/pip-overlay/remove`
- `GET /api/pip-overlay/templates`

Common body fields:

- `channel`, `layer`
- `stackIndex` (0-based)
- `nextContentLayer` (recommended for safe band resolution)
- `fill` object for geometry-aware templates:
  - `{ x, y, scaleX, scaleY }`

### Apply

- `POST /api/pip-overlay/apply`
- Body:
  - `channel`, `layer`, `stackIndex`
  - `overlay: { type, params }`
  - `fill`
  - optional `nextContentLayer`

### Update (in place)

- `POST /api/pip-overlay/update`
- Body:
  - `channel`, `layer`, `stackIndex`
  - `overlay: { type, params }`
  - `fill`
  - optional `nextContentLayer`

### Remove

- `POST /api/pip-overlay/remove`
- Body:
  - `channel`, `layer`
  - optional `nextContentLayer`

---

## 4) Look-level transport (non-live, full model)

For complete look snapshots (including effects + `pipOverlays` arrays per layer):

- `POST /api/scene/take`
- Body:
  - `channel`
  - `incomingScene` (full scene object with `layers[]`)
  - optional: `forceCut`, `framerate`, `currentScene`, `useServerLive`

This is the canonical endpoint for companion-driven look recall when controlling authored scene JSON.

---

## 5) Companion implementation guidance

- For **live inspector-like nudging**, use `/api/mixer/*`, `/api/mixer/effect`, and `/api/pip-overlay/*`.
- For **whole look recalls**, use `/api/scene/take`.
- When batching many deferred mixer calls, finish with `POST /api/mixer/commit`.
- Keep a local mapping from logical layer numbers to concrete Caspar `layer` numbers per your show model.

