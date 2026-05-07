# Companion: Looks Editor Selected Layer Control API

This guide documents the API endpoints a Companion module should use to control the currently targeted layer in the Looks editor workflow.

It is written as a deployment-ready reference for module developers.

## Important behavior first

- There is **no backend endpoint that returns the current UI-selected layer** from the Looks editor.
- Companion should treat "selected layer" as its own runtime target (for example, variables `targetChannel` + `targetLayer`).
- Live control happens through `/api/mixer/*` endpoints with explicit `channel` and `layer`.
- Full look recall happens through `/api/scene/take` with full `incomingScene`.

---

## 1) Health and routing assumptions

- Base URL: `http://<highascg-host>:8080`
- API prefix: `/api/*`
- Most control endpoints require Caspar to be connected.
- If Caspar is offline, mixer/scene calls return `503` with:
  - `{ "error": "Caspar not connected" }`

Quick check:

```bash
curl -s "http://<host>:8080/api/scene/live"
```

---

## 2) Core selected-layer live control endpoints

All endpoints below require JSON body containing at least:

- `channel` (number)
- `layer` (number)

### Geometry / transform

- `POST /api/mixer/fill`
  - body: `x`, `y`, `xScale`, `yScale`
  - optional: `stretch`, `layerX`, `layerY`, `layerW`, `layerH`, `channelW`, `channelH`
  - optional transition: `duration`, `tween`, `defer`

- `POST /api/mixer/clip`
  - body: `x`, `y`, `xScale`, `yScale`

- `POST /api/mixer/anchor`
  - body: `x`, `y`

- `POST /api/mixer/rotation`
  - body: `degrees`

- `POST /api/mixer/opacity`
  - body: `opacity`

- `POST /api/mixer/keyer`
  - body: `keyer` (`0` or `1`)

### Audio

- `POST /api/audio/volume`
  - body: `channel`, `layer`, `volume`

### Commit / reset

- `POST /api/mixer/commit`
  - body: `channel`
  - use after deferred operations (`defer: true`)

- `POST /api/mixer/clear`
  - body: `channel`, `layer`

---

## 3) Inspector effects endpoint (single route)

Use:

- `POST /api/mixer/effect`

Body:

- `channel`, `layer`
- `effectType` (or `type`)
- `params` object
- optional transition fields (`duration`, `tween`, `defer`) where supported

Supported `effectType` values:

- `blend_mode`
- `brightness`
- `contrast`
- `saturation`
- `levels`
- `chroma_key`
- `crop`
- `clip_mask`
- `perspective`
- `grid`
- `keyer`
- `rotation`
- `anchor`

---

## 4) PIP overlay endpoints for selected layer

- `POST /api/pip-overlay/apply`
- `POST /api/pip-overlay/update`
- `POST /api/pip-overlay/remove`
- `GET /api/pip-overlay/templates`

Common control fields:

- `channel`, `layer`
- `stackIndex` (0-based)
- optional `nextContentLayer`
- `fill: { x, y, scaleX, scaleY }` (required for apply/update)

---

## 5) Full look recall endpoint

- `POST /api/scene/take`

Required:

- `channel`
- `incomingScene` object with `layers[]`

Optional:

- `forceCut`
- `framerate`
- `currentScene`
- `useServerLive`

Use this when Companion recalls complete Looks, not incremental layer tweaks.

---

## 6) Recommended Companion module architecture

### A) Keep target layer locally

Maintain module state:

- `targetChannel` (default from show routing)
- `targetLayer` (set by button action/encoder context)

Every "selected layer control" action sends these values in the request body.

### B) Build generic request helper

Create one helper in module code:

- `postApi(path: string, body: object): Promise<any>`
- Adds `channel` + `layer` automatically for layer actions
- Handles `503` and `502` errors in logs + feedback state

### C) Expose actions by intent

- `Layer Fill`
- `Layer Opacity`
- `Layer Rotation`
- `Layer Keyer`
- `Layer Effect` (typed)
- `Layer Audio Volume`
- `Layer Clear`
- `Look Take` (`/api/scene/take`)

### D) Optional "deferred batch" action

For smooth encoder workflows:

1. send multiple `/api/mixer/*` with `defer: true`
2. finalize with `/api/mixer/commit`

---

## 7) Copy-paste request examples

### Opacity on selected layer

```bash
curl -s -X POST "http://<host>:8080/api/mixer/opacity" \
  -H "Content-Type: application/json" \
  -d '{"channel":1,"layer":20,"opacity":0.75}'
```

### Rotation with transition

```bash
curl -s -X POST "http://<host>:8080/api/mixer/rotation" \
  -H "Content-Type: application/json" \
  -d '{"channel":1,"layer":20,"degrees":15,"duration":12,"tween":"easeout"}'
```

### Effect apply (brightness)

```bash
curl -s -X POST "http://<host>:8080/api/mixer/effect" \
  -H "Content-Type: application/json" \
  -d '{"channel":1,"layer":20,"effectType":"brightness","params":{"value":1.1}}'
```

### Scene take (full look)

```bash
curl -s -X POST "http://<host>:8080/api/scene/take" \
  -H "Content-Type: application/json" \
  -d '{"channel":1,"incomingScene":{"id":"look_1","name":"LOOK 1","layers":[{"layerNumber":20,"source":{"type":"media","value":"AMB"}}]}}'
```

---

## 8) Known limitation and practical workaround

Limitation:

- `/api/selection` currently returns `{ ok: true }` and does not provide a queryable selected-layer state for external clients.

Workaround:

- The Companion module should own the "selected layer target" state directly (button press / encoder bank context / variable assignment), then send explicit `channel` + `layer` in each API call.

