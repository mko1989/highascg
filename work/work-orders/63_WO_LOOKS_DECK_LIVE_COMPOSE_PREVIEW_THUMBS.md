# Work Order 63: Looks deck — live compose preview on deck cards (Companion parity)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry
> 4. Do **not** delete previous agents' log entries

**Status:** In progress (Phase 0–1 implemented 2026-06-27)
**Priority:** Medium (operator UX — deck reflects what Caspar is actually outputting)  
**Related:**
- [57_WO_CASPAR_IMAGE_COMPOSE_PREVIEW.md](./57_WO_CASPAR_IMAGE_COMPOSE_PREVIEW.md) / [58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md](./58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md) — compose preview snapshot pipeline (`/api/compose-preview/{ch}.jpg`)
- [60_WO_CG_ONLY_LOOKS_DECK_VISUAL.md](./60_WO_CG_ONLY_LOOKS_DECK_VISUAL.md) — CG-only idle deck thumbs (checkerboard); **on-air overrides** to live stream per this WO
- [08_WO_CASPARCG_CLIENT_FEATURES.md](./08_WO_CASPARCG_CLIENT_FEATURES.md) — Looks deck / scene editor
- Companion module: `companion-module-highpass-highascg/src/look-air-state.js`, `feedbacks.js` (`look_compose_preview_image`), `bridge/compose-preview-poller.js`

**Out of scope:** Changing single-look edit canvas behavior; replacing compose preview panel; Companion module changes (reference only).

---

## 1. Problem statement

**Companion look buttons** already show the **live Caspar compose preview** when a look is on **PGM** or **PRV**: feedback `look_compose_preview_image` (and layered-button style overrides on `look_on_pgm` / `look_on_prv_for_screen`) bind `$(highpass-highascg:highascg_compose_preview_ch{N}_image)` — the same JPEG/PNG stream Caspar writes for the compose preview panel.

The **Looks deck / dashboard** (main editor listing many looks per screen column) does **not** do this today:

| Surface | On-air behavior today | Desired |
|---------|----------------------|---------|
| Compose preview panel (PRV/PGM cells) | `drawComposeSnapshotCell` when `composePreview.mode` is `ffmpeg_jpeg` or `caspar_image` | *(unchanged — reference)* |
| Companion look buttons | Live compose preview via `resolveLookAirState` + channel image variable | *(unchanged — reference)* |
| **Deck card thumbs** (`scenes-card__thumb-canvas`) | Always `drawSceneComposeStack` / CG-only checkerboard — **static media thumbs** | When look is on a **live Caspar channel** for that column → **compose preview stream** |
| **Single-look editor** (gear / edit mode) | Legacy canvas stack + layer media thumbs | **Keep legacy** — instant feedback while editing, no wait for Caspar sync |

Operators cueing looks from the deck need the **small card displays** to match what is on air, the same way Stream Deck buttons and the compose panel already do.

---

## 2. Goal

When viewing the **Looks main editor** (deck / list — **not** the per-look edit view):

1. If a look is **on program (PGM)** for that deck column’s main → deck thumb shows **`/api/compose-preview/{pgmCh}.jpg`** (or `.png` per mode) — identical source to the compose preview panel PGM cell.
2. If a look is **on preview (PRV)** for that main (and **not** on PGM for that main) → deck thumb shows the **PRV channel** compose preview.
3. If a look is **idle** (not on PGM or PRV for that column) → keep **today’s legacy thumbnail** path (`drawSceneComposeStack`, CG-only checkerboard per WO-60, media thumbs).
4. **PGM wins** when the same look is on both buses for a screen (match Companion `resolveLookAirState`).

When **editing a single look** (`sceneState.editingSceneId` set):

- **Do not** switch layer/compose canvas to live stream thumbs.
- Continue using **legacy thumbnails** and canvas compose stack so layer moves, source swaps, and opacity edits paint immediately without waiting for Caspar ffmpeg consumer cadence or ADD IMAGE tick.

---

## 3. Reference — Companion parity

Mirror the bus → channel mapping in [`look-air-state.js`](../../../companion-module-dev/companion-module-highpass-highascg/src/look-air-state.js):

```javascript
// Pseudocode — implement in HighAsCG client (shared helper)
function resolveLookAirComposeChannel(lookId, mainIdx, sceneState, channelMap) {
  const id = String(lookId).trim()
  if (!id) return null
  const pgmCh = channelMap?.programChannels?.[mainIdx]
  const prvCh = channelMap?.previewChannels?.[mainIdx]
  const hasPrv = prvCh > 0 && prvCh !== pgmCh

  if (pgmCh && sceneState.getLiveSceneIdForMain(mainIdx) === id) {
    return { bus: 'pgm', channel: pgmCh }
  }
  if (hasPrv && sceneState.getPreviewSceneIdForMain(mainIdx) === id) {
    return { bus: 'prv', channel: prvCh }
  }
  return null
}
```

Image URL / draw path: reuse existing client modules — no duplicate HTTP stack:

- [`client/lib/compose-preview-url.js`](../../client/lib/compose-preview-url.js) — `getComposePreviewUrl`, `isSnapshotComposePreview`
- [`client/components/preview-canvas-compose-snapshot.js`](../../client/components/preview-canvas-compose-snapshot.js) — `drawComposeSnapshotCell`, `trackComposePreviewChannel`, `subscribeComposePreviewRefresh`
- WS push: `compose.preview` → `ingestComposePreviewWs` (already wired in `app-ws-handlers.js`)

---

## 4. Current state (baseline)

| Area | File | Today | Gap |
|------|------|-------|-----|
| Deck thumb paint | [`scenes-editor.js`](../../client/components/scenes-editor.js) `paintDeckThumb` | CG-only → `drawCgOnlyLookDeckThumb`; else `drawSceneComposeStack(deckThumbnailMode)` | No `resolveLookAirComposeChannel` branch |
| Deck card DOM | [`scene-list.js`](../../client/components/scene-list.js) | Sets `--live` / `--preview` CSS from `getLiveSceneIdForMain` / `getPreviewSceneIdForMain` | Styling only — thumb content still static |
| Compose panel | [`scenes-editor.js`](../../client/components/scenes-editor.js) `renderComposeScene` | Uses `drawComposeSnapshotCell` when `isSnapshotComposePreview()` | **Reference** — deck should reuse same draw helper |
| Edit mode | [`scenes-editor-edit.js`](../../client/components/scenes-editor-edit.js) + `renderCompose` callback | Legacy thumbs via `getThumbUrlForLayerSource` | **Must stay unchanged** |
| CG-only idle thumbs | [`cg-only-look-deck-thumb.js`](../../client/components/cg-only-look-deck-thumb.js) | Server-rendered CG PNG on checkerboard | On-air → stream overrides idle CG thumb |
| Preview mode gate | Settings → `composePreview.mode` | Stream thumbs only when `ffmpeg_jpeg` or `caspar_image` | Deck follows same gate as compose panel (`isSnapshotComposePreview()`) |

When `composePreview.mode === 'canvas'`, deck thumbs remain legacy (compose panel also uses canvas stack in that mode).

---

## 5. Architecture

```text
renderSceneDeck()  →  paintDeckThumb(canvas)
  │
  ├─ sceneState.editingSceneId?  →  (deck hidden — N/A)
  │
  ├─ resolveLookAirComposeChannel(scene.id, deckMain, sceneState, channelMap)
  │     └─ channel != null  AND  isSnapshotComposePreview()?
  │           → drawComposeSnapshotCell(ctx, cw, ch, channel, { onLoaded: scheduleDraw })
  │           → trackComposePreviewChannel(channel)  // WS + meta poll
  │
  ├─ isCgOnlyLook(scene) && idle?
  │     → drawCgOnlyLookDeckThumb(...)   // WO-60 idle path
  │
  └─ else
        → drawSceneComposeStack(..., { deckThumbnailMode: true })   // legacy idle thumb
```

**Refresh cadence:** Deck repaints when:

- `scene.live` / preview scene id changes (already triggers `scheduleRender` via `stateStore.on('*', …)`)
- `compose.preview` WS event or compose snapshot etag change (`subscribeComposePreviewRefresh` — already used by compose panel in `scenes-editor.js`)

Do **not** poll every deck card independently; reuse the shared `_cache` in `preview-canvas-compose-snapshot.js`.

---

## 6. UX rules (normative)

| Condition | Deck thumb content |
|-----------|-------------------|
| Look on **PGM** for column main | Live compose preview from **PGM Caspar channel** |
| Look on **PRV only** for column main | Live compose preview from **PRV Caspar channel** |
| Look **idle** | Legacy stack thumb (media / placeholders / CG-only checkerboard) |
| **`composePreview.mode === 'canvas'`** | Legacy stack thumb always (no stream) |
| **Editing single look** | N/A — deck not visible; edit canvas uses **legacy only** |
| Global look (`mainScope: 'all'`) | Per-column: use that column’s main index for PGM/PRV resolution |

**Visual chrome:** Keep existing `scenes-card--live` / `--preview` rings and WO-60 CG-only background tokens. Live stream image draws **inside** `.scenes-card__thumb-canvas`; rings remain the bus indicator.

**Empty / loading:** While compose JPEG has not loaded yet, show the same placeholder as compose panel (`PGM ch N…` text) or optionally hold last legacy thumb until first frame — pick one in implementation; document in Work Log.

---

## 7. Tasks

### Phase 0 — Helper + gate

- [x] **T63.0.1** Add `resolveLookAirComposeChannel(lookId, mainIdx, sceneState, channelMap)` in [`client/lib/look-air-compose-channel.js`](../../client/lib/look-air-compose-channel.js) (≤80 lines; mirror Companion `resolveLookAirState` channel half)
- [x] **T63.0.2** Unit smoke: [`tools/smoke/smoke-look-air-compose-channel.test.js`](../../tools/smoke/smoke-look-air-compose-channel.test.js) — PGM wins, PRV-only, idle, no PRV bus

### Phase 1 — Deck thumb integration

- [x] **T63.1.1** Update `paintDeckThumb` in [`scenes-editor.js`](../../client/components/scenes-editor.js): on-air + `isSnapshotComposePreview()` → `drawComposeSnapshotCell`
- [x] **T63.1.2** Ensure `subscribeComposePreviewRefresh` repaints deck when tracked channels update (compose panel already subscribes — extend or share callback)
- [x] **T63.1.3** CG-only looks: on-air → stream; idle → existing `drawCgOnlyLookDeckThumb`
- [x] **T63.1.4** Verify `scene-list.js` deck re-render on `scene.live` / preview id changes covers take/cut/prv without full page reload

### Phase 2 — Edit mode guard (regression)

- [x] **T63.2.1** Confirm [`scenes-editor-edit.js`](../../client/components/scenes-editor-edit.js) / `renderCompose` path **never** calls `drawComposeSnapshotCell` for layer editing canvas
- [ ] **T63.2.2** Manual QA: edit look → drag layer → thumb updates instantly (legacy); deck visible after closing edit → on-air card shows stream

### Phase 3 — QA & docs

- [ ] **T63.3.1** Manual QA with `composePreview.mode = ffmpeg_jpeg`: cue look to PRV → deck thumb matches compose PRV cell; take to PGM → thumb matches PGM cell; clear bus → legacy thumb returns
- [ ] **T63.3.2** Compare deck thumb to Companion button image for same look (visual parity)
- [ ] **T63.3.3** Update [`project_status.md`](./project_status.md) when shipping

---

## 8. Acceptance criteria

1. With snapshot compose preview enabled, a look **on PRV** shows the **same live image** in its deck card as the compose preview PRV cell and a Companion look button bound to that look.
2. After **take to PGM**, the deck card switches to the **PGM channel** stream without manual refresh.
3. **Idle** looks still show legacy/media/CG-only thumbnails (no regression to WO-60 idle behavior).
4. **Single-look editor** continues to use legacy layer thumbnails for all edits; no perceptible lag waiting for Caspar sync when moving layers.
5. With `composePreview.mode = canvas`, behavior is unchanged from today (legacy deck thumbs only).

---

## 9. Non-goals

- Per-layer live stream inside the edit inspector
- Replacing CG-only **idle** checkerboard thumbs (WO-60)
- Showing compose stream for looks routed to non-PGM/PRV channels (multiview cells, stream encoders, etc.) unless extended in a future WO
- Companion module code changes

---

## Work Log

*(Agents: add entries below in reverse chronological order)*

### 2026-06-27 — Agent (deck panel sync — scene.live per column)

**Work Done:**

- **Wrong-panel bug:** Deck rings/thumbs could use stale `previewSceneIdByMain` or wrong main index (`activeScreenIndex` fallback when `deckMain` unset on single-screen).
- Added `resolveBusLookIdsForMain` — reads PGM/PRV look ids per main **directly from `scene.live`** channel keys (authoritative).
- Deck cards always set `data-deck-main={col}`; thumbs use column index 0 when unset (not active screen).
- `scene-list.js` PRV/PGM rings use `resolveBusLookIdsForMain(col, scene.live, …)`.
- `resolveLookAirComposeChannel` also prefers `scene.live` for stream thumb matching.
- Smoke tests extended (15 pass).

**Instructions for Next Agent:** Reload web UI; multi-main: verify PRV ring only on correct column for global looks. Manual QA T63.2.2 / T63.3 still open.

### 2026-06-27 — Agent (preview state sync fix)

**Work Done:**

- **Root cause:** Deck PRV flags used client `previewSceneIdByMain` (set when cueing a look), but after a PGM take with PRV exchange the server puts the **previous PGM look** on PRV in `scene.live` — client preview slot was never updated.
- Added `syncMainSlotsFromSceneLive` (`client/lib/scene-live-main-sync.js`, `src/engine/scene-live-main-sync.js`) — derives PGM + PRV look ids from authoritative `scene.live`.
- `applyServerLiveChannels` now syncs **both** PGM and PRV slots; emits `previewScene` when PRV slot changes.
- `takeSceneToProgram` calls `applyServerLiveChannels(mergedLive)` immediately after take response.
- Deck cards: PRV ring hidden when same look is on PGM (`onPreview && !onPgm`).
- Smoke: `tools/smoke/smoke-scene-live-main-sync.test.js`.

**Instructions for Next Agent:** Manual QA — cue look C to PRV, take look B to PGM; deck should show B on PGM and **previous PGM look** on PRV (not C).

### 2026-06-27 — Agent (Phase 0–1 implementation)

**Work Done:**

- Added `resolveLookAirComposeChannel` in `client/lib/look-air-compose-channel.js` + `src/engine/look-air-compose-channel.js` (Companion `look-air-state.js` parity: PGM wins, PRV-only, idle).
- Smoke test `tools/smoke/smoke-look-air-compose-channel.test.js` — 7 cases pass.
- Refactored `paintDeckThumb` in `scenes-editor.js`: on-air looks + `isSnapshotComposePreview()` → `drawComposeSnapshotCell`; idle CG-only → checkerboard; idle else → legacy stack.
- `subscribeComposePreviewRefresh` now calls `repaintDeckThumbs()` (lightweight canvas repaint, no full deck DOM rebuild).
- Verified edit path (`scenes-editor-edit.js`, `scenes-compose.js`) does not use compose snapshot.

**Status:** Phase 0–1 complete; Phase 2 manual QA + Phase 3 hardware validation pending.

**Instructions for Next Agent:**

1. Manual QA on hardware with `composePreview.mode = ffmpeg_jpeg` (T63.2.2, T63.3).
2. Compare deck thumb to Companion button for same look on PRV then PGM.

### 2026-06-27 — Agent (WO-63 created)

**Work Done:**

- Created this work order from operator request: deck/dashboard look cards should show live Caspar compose preview when on PGM/PRV (Companion button parity); single-look edit view must keep legacy thumbnails for instant edits.
- Mapped reference implementation (Companion `look-air-state.js`, client `drawComposeSnapshotCell`) and baseline gaps in `scenes-editor.js` `paintDeckThumb`.

**Status:** Draft — implementation not started.

**Instructions for Next Agent:**

1. Implement T63.0.1 helper + smoke test first.
2. Wire `paintDeckThumb` (T63.1.x); reuse `drawComposeSnapshotCell` — do not fork a second image loader.
3. Explicitly verify edit mode regression (T63.2) before marking complete.

---
*Work Order created: 2026-06-27 | Series: HighAsCG Looks / compose preview*
