# Walkthrough: client agent — PGM look take (no client AMCP)

**Audience:** Agent working in **`highascg-client`** (Electron + `dist-web`), **not** the legacy `client/` tree in **`highascg`** (server repo).

**Problem we hit:** Fade-to-black between looks on PGM-only routing. Caspar logs showed `STOP 1-10` + `CG 1-11..18 CLEAR` **before** each server take. HACG server logs showed `exitLayers=0` — the server take path was correct; **client-side preview AMCP** was clearing PGM layer 10 first.

**Root cause:** The client still builds and sends look-stack AMCP (`STOP`/`CLEAR`/`PLAY`/`LOADBG`) via `POST /api/amcp/batch`. That violates the server/client split documented in [`BACKEND_AND_CLIENT_SPLIT.md`](./BACKEND_AND_CLIENT_SPLIT.md).

---

## Correct architecture

```
Operator clicks "Take Look 2"
        │
        ▼
┌───────────────────┐
│  Client (UI only) │  POST /api/scene/take { channel, sceneId, forceCut? }
│  highascg-client  │  — no Caspar command strings
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  Server (bridge)  │  resolveSceneById → runSceneTakePgmOnly / runSceneTakeLbg
│  highascg src/    │  → AMCP TCP to Caspar
└─────────┬─────────┘
          │
          ▼
      Caspar :5250
```

**Client job:** pick look id, pick main/channel, call **one** REST endpoint, merge `sceneLive` + WS into UI state.

**Server job:** diff outgoing/incoming looks, emit the full AMCP sequence (LOADBG MIX, MIXER FILL, COMMIT, PLAY, teardown of truly exiting layers only).

---

## What the server already provides (this repo)

Do **not** reimplement this on the client.

| Piece | Location |
|-------|----------|
| Take API | `POST /api/scene/take` — [`src/api/routes-scene.js`](../src/api/routes-scene.js) |
| Resolve look by id | `sceneId` / `lookId` / `incomingSceneId` → [`resolveSceneById`](../src/engine/project-scenes.js) |
| PGM-only path (no A/B banks) | `bus1 == null` → [`runSceneTakePgmOnly`](../src/engine/scene-take-pgm-only.js) |
| +Animate AMCP order | `LOADBG … MIX <dur>`, `MIXER FILL … <dur>`, **one** `MIXER ch COMMIT`, plain `PLAY` (no MIX on PLAY) |
| API docs | [`docs/wiki/api/scene-take.md`](../docs/wiki/api/scene-take.md) |

### Minimal program take (what the client should send)

```http
POST /api/scene/take
Content-Type: application/json

{
  "channel": 1,
  "sceneId": "f0b3c0fb-ed80-4852-b7ad-e34f7c52df88",
  "forceCut": false,
  "useServerLive": true,
  "framerate": 25
}
```

Server loads the full look JSON from the synced project (`scene_deck_sync` / project file). **Do not** POST the entire `incomingScene` on every deck take unless you have unsaved edits not yet on the server.

### Cut take

Same body with `"forceCut": true`.

### Preview bus (PGM + PRV only — not PGM-only)

Stage on PRV without touching PGM:

```json
{
  "channel": 1,
  "sceneId": "<look-id>",
  "target": "preview",
  "forceCut": true
}
```

### PGM-only routing (`bus1=n/a` in server logs)

- **Only** use program take (`POST /api/scene/take` without `target`).
- **No** preview AMCP, **no** `POST /api/amcp/batch` for look-stack layers on channel 1.
- Deck **Take (▶)** and **Cut** buttons only; no "send to preview" on PGM-only mains.

---

## Expected Caspar log (PGM-only +Animate, same layer L10)

No leading `STOP`/`CLEAR` before `LOADBG`:

```text
LOADBG 1-10 … MIX 25 linear
MIXER 1-10 FILL … 25 linear
MIXER 1-10 KEYER 0
MIXER 1 COMMIT
PLAY 1-10 …
```

If you still see `STOP 1-10` + `CG 1-11..18` before `LOADBG`, something on the **client** is still pushing preview AMCP to PGM.

---

## Client changes required (`highascg-client`)

> **Note:** Any edits under `highascg/client/` in the server repo are **legacy/dev-only** and are **not shipped** on the playout stick. Port the behaviour below into **`highascg-client`**, then stop maintaining look AMCP in the server tree.

### 1. Deck take — one API call only

**Replace** `createTakeSceneToProgram` (or equivalent) so it:

1. Resolves `channel` from `channelMap.programChannels[mainIdx]`.
2. Calls `POST /api/scene/take` with **`sceneId`** (and `forceCut`, `framerate`, `useServerLive: true`).
3. Merges response `sceneLive` into local state; subscribe to WS `sceneLive` for other panels.
4. **Does not** call `postAmcpPreviewPipeline`, `waitForPreviewPushComplete`, or any `/api/amcp/batch` before/after take.

**Remove** building `incomingScene` on the client for a simple deck take if the look is already synced via `scene_deck_sync`.

Optional: if the operator has **unsaved** compose edits, either (a) save/sync first, or (b) send full `incomingScene` — but never **also** send preview AMCP clears.

### 2. Delete or disable look-stack preview AMCP on program

These modules (names from legacy in-repo client — find equivalents in `highascg-client`):

| Module | Action |
|--------|--------|
| `lib/amcp-preview-batch.js` | **Remove** from look/deck take path. Keep only if a dedicated inspector feature still needs it **and** targets PRV only. |
| `lib/scenes-preview-push-scene.js` | **Do not run** for PGM-only mains. For PGM/PRV, preview staging should use `POST /api/scene/take` with `target: "preview"`, not client-built STOP/CLEAR/PLAY. |
| `components/scenes-preview-runtime.js` | Remove preview push queue around take; no `schedulePreviewPush` on live take. |
| `lib/scenes-preview-global-border.js` | Border AMCP on take should be server-side (future) or bundled in take API — not a separate client batch to PGM. |

**Hard rule:** If `channelMap.previewEnabledByMain[mIdx] === false` or preview channel is null/shared with PGM → **zero** look-stack AMCP from the client.

### 3. Deck UI behaviour

| Control | PGM-only | PGM + PRV |
|---------|----------|-----------|
| **Take ▶** | `POST /api/scene/take` `{ sceneId, channel, forceCut: false }` | Same |
| **Cut** | `forceCut: true` | Same |
| **Card click / PRV** | Toast: "PGM-only — use Take" — **no AMCP** | `POST /api/scene/take` `{ sceneId, channel, target: "preview", forceCut: true }` |
| **Compose edit** | UI-only until Take; optional future `POST /api/scene/preview` on server | Preview via server preview take, not client AMCP |

Do **not** attach `click` on the whole deck card to a preview push on PGM-only layouts.

### 4. State sync before take

Server resolves `sceneId` from **its** project copy. Ensure looks are synced before take:

- WebSocket `scene_deck_sync` (already used) must run after edits.
- On take failure `"incomingScene object required"`, sync/debounce issue — retry after sync, don't fall back to client AMCP.

### 5. Global border (if used)

Legacy client merged `globalBorder` from `sceneState` into `incomingScene` on take. Until server reads borders from project:

- Either include borders in `scene_deck_sync` → server project `globalBorders`, **or**
- Keep sending `incomingScene.globalBorder` only when border changed and not on server yet.

Prefer server-side merge in a follow-up (`routes-scene.js` + project store) so client sends **only** `sceneId`.

### 6. What can stay on the client

| OK on client | Not OK on client |
|--------------|------------------|
| Canvas compose UI, thumbnails, drag-drop | `STOP`/`CLEAR`/`LOADBG`/`PLAY` strings for looks |
| `POST /api/scene/take`, `GET /api/state` | `POST /api/amcp/batch` for look transitions on PGM |
| WebRTC preview `<video>` | Guessing Caspar layer teardown (CG 11–18 sweeps) |
| `scene_deck_sync` JSON | `buildPipOverlayRemoveLines(..., 10000)` before take |

Sources panel **stop** buttons (`POST /api/raw`) are a separate operator tool — not part of look take.

---

## Verification checklist (client agent)

After changes in **`highascg-client`** against a **PGM-only** server (`bus1=n/a` in HACG logs):

1. Hard-reload Electron client (not legacy in-repo `client/` unless dev proxy).
2. Take Look 1 → Look 2 → Look 3 with +Animate.
3. **Caspar log:** each take starts with `LOADBG` — **no** preceding `STOP 1-10` / `CG 1-11..18` block.
4. **HACG log:** `[scene-take-pgm-only] exitLayers=0` for same-layer swaps.
5. **Network tab:** deck take = **one** `POST /api/scene/take` — **no** `/api/amcp/batch` immediately before it.
6. Visual: crossfade on same L10, no dip to black.

---

## Server-side follow-ups (optional, this repo)

These are **not** blockers for the client walkthrough but align with "client sends play look 2":

| Item | Why |
|------|-----|
| Document `sceneId`-only take as primary example in `scene-take.md` | Client agents keep sending fat `incomingScene` |
| Merge `globalBorder` from server project on take | Drop client `incomingScene` entirely |
| `POST /api/scene/preview` alias | Explicit "stage look on PRV" without overloading take docs |
| Log `[scene-take]` when `/api/amcp/batch` hits PGM during take chain | Catch regressions from any client |

---

## Summary for client agent

1. **Stop** sending look-stack AMCP from the client — that caused fade-to-black (`STOP` before `LOADBG`).
2. **Deck take =** `POST /api/scene/take` with `{ channel, sceneId, forceCut?, framerate?, useServerLive: true }`.
3. **PGM-only =** program take only; no preview push, no `/api/amcp/batch` for looks on PGM.
4. Work in **`highascg-client`**; treat `highascg/client/` as legacy reference only, not the shipping UI.

**Reference logs:** [`work/logs`](./logs) (2026-06-15) — STOP block at 20:07:39.449, server take at 20:07:39.472, `exitLayers=0`.
