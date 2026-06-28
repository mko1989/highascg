# Work Order 71: Look PGM playback thumbnail cache (5 s capture, GUI + Companion)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry
> 4. Do **not** delete previous agents' log entries

**Status:** Draft — implementation not started  
**Priority:** Medium–High (operator UX — deck and Stream Deck show “what this look looks like on air” without live video churn)  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on (required reading):**
- [63_WO_LOOKS_DECK_LIVE_COMPOSE_PREVIEW_THUMBS.md](./63_WO_LOOKS_DECK_LIVE_COMPOSE_PREVIEW_THUMBS.md) — **live** compose stream while on PGM/PRV; this WO adds **persistent idle** thumbs from last PGM air
- [58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md](./58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md) / [57_WO_CASPAR_IMAGE_COMPOSE_PREVIEW.md](./57_WO_CASPAR_IMAGE_COMPOSE_PREVIEW.md) — compose preview JPEG/PNG source for capture (no new Caspar consumer)
- [60_WO_CG_ONLY_LOOKS_DECK_VISUAL.md](./60_WO_CG_ONLY_LOOKS_DECK_VISUAL.md) — CG-only idle thumbs; **PGM cache overrides** CG idle when present (same precedence as media stack)
- [42_WO_SOURCES_LIVE_THUMBNAILS_AND_MEDIA_THUMB_FOLDER.md](./42_WO_SOURCES_LIVE_THUMBNAILS_AND_MEDIA_THUMB_FOLDER.md) — one-shot capture + disk cache patterns (no polling spam)

**Companion module (reference — follow-up PR):**
- `companion-module-highpass-highascg/src/look-air-frame.js` — immediate on-air snap from live compose variables (clears when off air)
- **This WO:** persistent **`highascg_look_pgm_thumb_{slug}`** per look — survives after bus clear; updated on each PGM session after capture delay

**Out of scope:** Replacing live compose preview on air (WO-63); per-layer thumbs in edit mode; follower-side capture during hot backup (leader only unless extended).

---

## 1. Problem statement

Operators want **stable thumbnails** that reflect **what a look actually looks like on program** after it has been playing for a few seconds — not a media-file poster frame, not a live 2 fps JPEG stream burning USB bandwidth on every Stream Deck key.

| Surface | Today | Desired |
|---------|-------|---------|
| **Deck card (idle look)** | Media stack / CG checkerboard / placeholders | **Last PGM air frame** (~5 s into playback) when available |
| **Deck card (on PGM/PRV)** | Live compose preview (WO-63) | *(unchanged — live stream while on air)* |
| **Companion look button (idle)** | Preset art or empty `look_air_frame` | **Cached PGM thumb** per look id |
| **Companion look button (on air)** | Live compose or `look_air_frame` snap | *(optional)* keep live override; idle image = cached PGM thumb |

**Operator request (2026-06-28):** Each time a look goes **on PGM**, capture **one** still for GUI and Companion **after 5 s of playback**, cache on disk, use as the look’s thumbnail when not live. Must be **smooth and crash-proof** — failures must never take down air. **No constant “is it 5 s yet?” polling.** For **very short clips**, capture at the **middle** of the clip instead of waiting 5 s.

---

## 2. Goals (normative)

### G1 — Event-driven scheduling (no poll loops)

1. **Arm exactly one timer** when `liveSceneState.setChannel()` assigns a look to a **program channel** (hook existing `onProgramChange` — same pattern as replication in `replication-service.js`).
2. **Cancel** the timer when:
   - That look leaves PGM (bus clear, take to another look, channel invalidated)
   - The same channel gets a **different** look before the timer fires
   - Server shutdown / module `reset()`
3. **Never** run a global interval that checks all looks every N ms.
4. Delay clock starts **after bus transition settle** (reuse `transitionMsFromOpts` / `scheduleSettle` semantics from [`compose-preview-activity.js`](../../src/preview/compose-preview-activity.js)) plus **playback delay** (§2.2).

### G2 — Capture timing

| Case | Capture moment (after settle) |
|------|----------------------------------|
| **Default** (long clip, live, loop, unknown duration) | **5000 ms** from playback start on PGM |
| **Short clip** — dominant layer duration **&lt; 10 s** | **50% of clip duration** (middle frame), minimum **300 ms** after settle |
| **Still image / static CG** (no active remaining) | **300 ms** after settle (same as compose idle capture — no 5 s wait) |
| **Look replaced on PGM before timer fires** | Cancel; no write for the superseded look |

**Dominant clip:** highest visible layer on PGM channel with a `file`/`template` producer; prefer OSC [`playback-tracker-osc.js`](../../src/state/playback-tracker-osc.js) `duration`/`remaining`/`elapsed`; fallback to [`playback-tracker.js`](../../src/state/playback-tracker.js) matrix `durationMs`/`startedAt`.

Configurable defaults (no UI v1 required — use `config/defaults.js`):

```javascript
lookPgmThumb: {
  enabled: true,
  delayMs: 5000,
  shortClipThresholdMs: 10000,
  minDelayMs: 300,
  guiMaxWidth: 640,
  companionSize: 72, // square JPEG for Stream Deck
}
```

### G3 — Capture source & outputs

1. **Primary source:** existing compose preview JPEG for the PGM channel ([`compose-preview-cache.js`](../../src/preview/compose-preview-cache.js) `resolvePreviewImagePath`) — requires `composePreview.mode` ∈ `ffmpeg_jpeg` | `caspar_image`.
2. **Fallback:** Caspar `PRINT` channel (channel-only) with bounded wait — same hygiene as WO-42; **one attempt**, timeout 3 s, then give up silently.
3. **Two derivatives** written atomically (temp + rename):
   - `{cacheDir}/{lookId}.jpg` — GUI deck (max width `guiMaxWidth`, preserve aspect)
   - `{cacheDir}/{lookId}_companion.jpg` — square companion thumb (`companionSize`)
4. Sidecar `{lookId}.meta.json`: `{ lookId, capturedAt, channel, delayMs, source: 'compose'|'print', sha256, sceneRevision? }`.

Cache directory: `data/look-pgm-thumbs/` (override via `look_pgm_thumb_cache_path`).

### G4 — Failure handling (hard requirement)

Every capture path must be wrapped so **no uncaught exception** propagates to take/air handlers:

- Missing compose JPEG → log `debug`, skip or try PRINT fallback once
- ffmpeg resize spawn fail → log `warn`, leave previous cache file untouched
- Disk full / permission → log `warn`, disable further captures until next successful write (circuit breaker — optional v1.1)
- Invalid look id → no-op
- **`composePreview.mode === 'canvas'`** → skip server capture (client legacy thumbs only); log once at boot

**Never** reject scene take API, block AMCP, or crash the Node process on thumbnail failure.

### G5 — Web UI consumption

When a look is **idle** on the deck (not on PGM/PRV per WO-63):

1. If `GET /api/looks/{id}/pgm-thumb.jpg` exists (or WS says cache ready) → draw cached JPG in `paintDeckThumb` **before** media stack / CG-only path.
2. While **on PGM/PRV** → WO-63 live compose stream wins (no change).
3. On `look.pgmThumb` WS event → repaint affected deck card only (no full deck rebuild).

Precedence (idle deck thumb):

```text
PGM cache JPG  →  CG-only checkerboard (WO-60)  →  legacy media compose stack
```

### G6 — Companion consumption

1. **HighAsCG API:** `GET /api/looks/{id}/pgm-thumb.jpg?variant=companion` (square) + optional manifest `GET /api/companion/look-pgm-thumbs` listing `{ lookId, mtimeMs, url }` for bootstrap.
2. **WS:** `look.pgmThumb` `{ lookId, mtimeMs, urls: { gui, companion } }` on successful capture.
3. **Companion module (follow-up):** new variable `highascg_look_pgm_thumb_{slug}` — set from companion JPG URL/base64 on WS; **idle** button image; layered buttons may still use live compose override when `look_on_pgm` (document in integration task).

Distinct from `highascg_look_air_frame_{slug}` (ephemeral on-air) — **PGM cache persists** until next successful PGM capture for that look.

### G7 — Hot backup

- **Leader only:** schedule and capture on local PGM `onProgramChange`.
- **Follower:** do not capture from mirrored air (would duplicate work and wrong epoch); may **read** synced cache files if rsync/show-data later includes `data/look-pgm-thumbs/` (v1.1 — document only).

---

## 3. Architecture

```text
PGM take → liveSceneState.setChannel(pgmCh, { sceneId, scene })
              │
              └─ onProgramChange (new hook in look-pgm-thumb-scheduler.js)
                    ├─ cancel prior timer for (pgmCh | lookId)
                    ├─ settleMs = transitionMsFromOpts(takeOpts, config)
                    ├─ playbackDelayMs = computeCaptureDelay(ctx, pgmCh, scene)  // 5s or mid-clip
                    └─ setTimeout(captureOnce, settleMs + playbackDelayMs)
                              │
                              ├─ verify look still on PGM for pgmCh (else abort)
                              ├─ read compose preview JPG (or PRINT fallback)
                              ├─ ffmpeg resize → gui + companion files
                              ├─ write meta.json
                              └─ WS look.pgmThumb + optional companion bridge push
```

**No tick loop.** Optional: if OSC reports clip **ends before** scheduled fire (short clip edge case), listen **once** via existing OSC subscription to fire early at mid-point — still event-driven, not polling.

```text
paintDeckThumb (client)
  ├─ on-air? → WO-63 drawComposeSnapshotCell
  ├─ else cached pgm thumb URL? → drawImage / img loader
  └─ else WO-60 / legacy stack
```

---

## 4. Implementation map

| Area | Path |
|------|------|
| Scheduler (timers, cancel, delay math) | `src/media/look-pgm-thumb-scheduler.js` **(new)** |
| Capture (read compose JPG, PRINT fallback, ffmpeg) | `src/media/look-pgm-thumb-capture.js` **(new)** |
| Disk cache paths + stat | `src/media/look-pgm-thumb-cache.js` **(new)** |
| Dominant clip duration helper | `src/media/look-pgm-thumb-timing.js` **(new)** — reuse OSC/playback-tracker |
| Wire `onProgramChange` at boot | `src/server.js` or existing preview init |
| HTTP routes | `src/api/routes-look-pgm-thumb.js` **(new)** |
| Config defaults | `src/config/defaults.js` |
| Client URL helper | `client/lib/look-pgm-thumb-url.js` **(new)** |
| Deck integration | [`client/components/scenes-editor.js`](../../client/components/scenes-editor.js) `paintDeckThumb` |
| WS handler | [`client/app-ws-handlers.js`](../../client/app-ws-handlers.js) |
| Unit tests | `tools/smoke/smoke-look-pgm-thumb-timing.test.js`, `test/look-pgm-thumb-scheduler.test.js` |
| Companion follow-up | `companion-module-highpass-highascg/src/look-pgm-thumb.js` |

**Reuse — do not duplicate:**
- [`live-scene-state.js`](../../src/state/live-scene-state.js) `onProgramChange`
- [`compose-preview-cache.js`](../../src/preview/compose-preview-cache.js) `waitForPngStable` / JPEG read patterns
- [`compose-preview-companion-thumb.js`](../../src/preview/compose-preview-companion-thumb.js) ffmpeg resize patterns
- [`cg-look-thumb-cache.js`](../../src/media/cg-look-thumb-cache.js) atomic write + hash conventions

---

## 5. API (v1)

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/looks/:lookId/pgm-thumb.jpg` | JPEG (gui variant), `404` if missing, `Cache-Control: private`, `ETag` from mtime/sha256 |
| `GET` | `/api/looks/:lookId/pgm-thumb.jpg?variant=companion` | Square companion JPEG |
| `GET` | `/api/companion/look-pgm-thumbs` | `{ ok, thumbs: [{ lookId, mtimeMs, guiUrl, companionUrl }] }` |

**WS event:** `look.pgmThumb` — `{ lookId, mtimeMs, guiUrl, companionUrl }`

---

## 6. UX rules

| Condition | Deck thumb |
|-----------|------------|
| On PGM or PRV (WO-63) | Live compose preview |
| Idle + PGM cache exists | Cached PGM JPEG |
| Idle + no cache | WO-60 / legacy stack (today) |
| Capture in progress | Keep **previous** cache or legacy thumb (no spinner required v1) |
| Look edited (layers changed) | Cache remains until **next** PGM air (optional v1.1: invalidate on scene save if `scene.updatedAt` &gt; `meta.capturedAt`) |

---

## 7. Tasks

### Phase 0 — Timing + scheduler skeleton

- [ ] **T71.0.1** `computeCaptureDelayMs(ctx, channel, scene, config)` — 5 s default, mid-clip when duration &lt; 10 s, still-image fast path
- [ ] **T71.0.2** Unit tests for timing matrix (long clip, 3 s clip, 800 ms clip, still, loop/no duration)
- [ ] **T71.0.3** `look-pgm-thumb-scheduler.js` — register `onProgramChange`, one timer per `{ channel, lookId }`, cancel on supersede/clear, `reset()` for tests

### Phase 1 — Capture + cache

- [ ] **T71.1.1** `look-pgm-thumb-cache.js` — paths, ensure dir, atomic write, read stat/ETag
- [ ] **T71.1.2** `look-pgm-thumb-capture.js` — compose JPG read + ffmpeg derivatives; PRINT fallback; all errors caught
- [ ] **T71.1.3** Wire scheduler → capture; verify still on PGM before write
- [ ] **T71.1.4** Config keys in `defaults.js`; respect `enabled: false`

### Phase 2 — API + WS

- [ ] **T71.2.1** `routes-look-pgm-thumb.js` + router registration
- [ ] **T71.2.2** Emit `look.pgmThumb` on success; optional companion manifest route
- [ ] **T71.2.3** Boot hook when `composePreview.mode === 'canvas'` — log skip, do not register scheduler (or register no-op)

### Phase 3 — Web UI

- [ ] **T71.3.1** `look-pgm-thumb-url.js` + deck `paintDeckThumb` idle branch (below WO-63 on-air check)
- [ ] **T71.3.2** WS handler repaints single card on `look.pgmThumb`
- [ ] **T71.3.3** Manual QA: take look A → wait → idle deck shows capture; take look B on PGM → A reverts to cache; short clip captures mid-clip

### Phase 4 — Companion integration (separate PR)

- [ ] **T71.4.1** `look-pgm-thumb.js` — variables `highascg_look_pgm_thumb_{slug}`, bootstrap from manifest, WS update
- [ ] **T71.4.2** Preset docs: idle image = PGM cache; on-air = existing live override
- [ ] **T71.4.3** Compare visual parity: cached thumb vs WO-63 live frame at ~5 s

### Phase 5 — QA & docs

- [ ] **T71.5.1** Failure injection: delete compose JPG mid-wait → no crash, previous cache kept
- [ ] **T71.5.2** Rapid PGM swaps → no duplicate timers, no file corruption
- [ ] **T71.5.3** Update [`project_status.md`](./project_status.md) when shipping

---

## 8. Acceptance criteria

1. After taking a look to PGM with a **30 s clip**, **~5 s after playback** (post transition) a cached JPG appears; idle deck card and API serve it.
2. A **2 s clip** produces a capture at **~1 s** (middle), not after 5 s or after clip end.
3. **No** `setInterval` or query-cycle hook that asks “is it 5 s yet?” for all looks — only **one** `setTimeout` per active PGM capture arm.
4. Forced capture failure (permissions, missing file) **never** throws out of take path; air continues.
5. With look on PGM, deck still shows **live** WO-63 stream; after clear, **cached** thumb shows within one WS event.
6. Companion module can bind idle button art to **`highascg_look_pgm_thumb_{slug}`** (Phase 4).

---

## 9. Non-goals

- Continuous refresh while on PGM (that is WO-63 / compose preview)
- Capturing from PRV bus only (PGM-only v1)
- Invalidating cache on every scene JSON edit (optional v1.1)
- Follower-side capture during replication
- Storing full-resolution PNG archives in media browser

---

## 10. Work Log

*(Agents: add entries below in reverse chronological order)*

### 2026-06-28 — Agent (WO-71 created)

**Work Done:**

- Created work order from operator request: event-driven PGM playback thumbnail cache at ~5 s (mid-clip for short media), GUI deck + Companion per-look image, crash-safe, no poll loops.
- Mapped hooks (`onProgramChange`), compose preview read path, WO-63 precedence, and Companion `look-air-frame` distinction.

**Status:** Draft — implementation not started.

**Instructions for Next Agent:**

1. Implement Phase 0 timing tests + scheduler first — prove cancel/supersede before any ffmpeg work.
2. Use compose preview JPEG as primary source; gate on `composePreview.mode !== 'canvas'`.
3. Wire deck idle branch only after API returns 200 on lab hardware.

---

*Work Order created: 2026-06-28 | Series: HighAsCG Looks / thumbnails / Companion | Parent: 00_PROJECT_GOAL.md*
