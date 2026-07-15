# Multiview + Template WO Review — 2026-07-15

Scope: WO-156, 190, 191, 195, 201, 203, 204, 206, 212, 213, 215, 220 (`work/work-orders/`).
Reviewer: adversarial code review agent, read-only. Live probes (`GET /api/state`, `GET /api/multiview/debug`) hit; no mutation, no restarts.

Smokes run (all green, 48/48):
```
node --test tools/smoke/smoke-wo212-mv-playlist-labels.test.js tools/smoke/smoke-wo213-preview-invalidate.test.js \
  tools/smoke/smoke-wo220-shadow-geometry.test.js tools/smoke/smoke-multiview-apply-lock.test.js \
  tools/smoke/smoke-multiview-reapply.test.js tools/smoke/smoke-route-self-loop-guard.test.js \
  tools/smoke/smoke-multiview-timers-geometry.test.js
```
`template/multiview_master.html`'s inline `<script>` extracted and `node --check`'d clean.

---

## Verdict table

| WO | Title | Verdict |
|----|-------|---------|
| 156 | Route self-loop guard + reapply | **Holds up.** Guard, reapply engine, refresh button, "Unblock" (superseded by WO-175 as logged — confirmed no `Unblock` string remains, FTB does channel clear) all verified at claimed anchors. |
| 190 | MV crop mismatch (diagnostic) | **Holds up, honestly incomplete.** Apply lock + `/api/multiview/debug` verified live (curl confirmed both serve real data). Root cause genuinely unresolved (H1 stale-cell theory, not proven) — status label accurate. |
| 191 | Per-layer timer rows | **Holds up.** Superseded/refined by WO-195/203/204 as logged; current code matches final spec, not the WO-191-era description (expected — later WOs iterated). |
| 195 | Overlay refinements (PIP exclusion, PRV mapping) | **Holds up.** PRV logical-layer mapping, pip-template exclusion regex, strict runtime guard all byte-parity between master/overlay. |
| 201 | Apply deadlock + compose fps | **Holds up.** Settled-continuation (`newChain.catch(() => {})`) confirmed still in place at `src/engine/multiview-apply.js:118-125`. `-r ${fps}` confirmed in `compose-preview-ffmpeg-args.js:100`. |
| 203 | Timer size + highlight setting | **Holds up.** `timerScale`/`highlightTopTimer` clamp identical client (`multiview-state.js:288`) and server (`multiview-apply.js:143-144`); master parity patch (logged 2026-07-14) verified present. |
| 204 | Timer polish round 2 | **Holds up.** Doubled base sizes (18/16/6/22) identical in master JS and overlay CSS; full-width dock formula identical (`lw - 2*pad`); highlight chip + truncation present in both. Overlay CSS has one **stale comment** (not a functional bug, see below). |
| 206 | Auto-apply + resolution display | **Real bug found** — see #1 below. Resolution-display fix itself is correct and verified (`multiview-editor-canvas-layout.js:61-112`, prefers `cell.screenIdx`, no hardcoded 1920x1080). Minor: work-log claims fallback text "unknown"; actual code just omits the suffix — cosmetic mismatch, not worth fixing. |
| 212 | Editor dock width + playlist labels | **Holds up.** `buildPlaylistRowLabel` confirmed byte-identical between `template/multiview_master.html:219-245` and `template/multiview_overlay.js:163-189`. Editor dock formula (`rect.lw - 16`) matches master's output formula. |
| 213 | PRV stale border after exchange | **Real bug found** (edge case) — see #2 below. Both `scene.live` call sites in `client/lib/app-ws-handlers.js` (lines 76-77 and 118-119) do call the invalidation helper *before* `applyServerLiveChannels`, as required. |
| 215 | MV cell scaling with timers dock | **Holds up, honest.** Status "Awaiting owner repro" is accurate — the evidence in the WO mathematically supports H1/H2 both being refuted (recomputed the pic-rect math independently: aspect-true, confirms 1.7777 = 1.7777). Minor: a couple of intermediate px figures in the WO's hand computation (`pw`, `ph`) are off by ~0.3px from `fraction × stage` — immaterial rounding-in-the-writeup, does not change the conclusion. |
| 220 | PIP shadow not rendering | **Holds up.** `background: rgba(0,0,0,0.002)` confirmed inside the `.pip-frame` rule (not appended dead) in both `template/pip_shadow.html:31` and `template/pip_glow.html:31`; no later rule overrides `background` on `.pip-frame`. WO honestly notes the manual on-hardware capture failed and marks A220.1 for owner check — not overclaimed. |

---

## Ranked real bugs

### 1. WO-206 auto-apply can fire mid-drag with unfinished cell geometry (no drag-in-progress guard)
**File:** `client/lib/multiview-state.js:216-221` (`setCell`) → `_save()` → `_persistLayout(true, true)` (line 345-366, emits `apply-request` unconditionally) and `client/components/multiview-editor.js:313` (`multiviewState.on('apply-request', () => { if (!isEnabled()) return; if (multiviewState.autoApply) scheduleApply() })`).

**Scenario:** During a cell move/resize, `canvas.onmousemove` (multiview-editor.js:183-279) calls `multiviewState.setCell(...)` on **every** mousemove tick, which unconditionally emits `'apply-request'`. The only thing standing between that and an actual AMCP apply is the 800 ms debounce (`applyDebounce.call()`). If the operator drags to a spot and pauses **while still holding the mouse button** (mid-resize, `dragMode` still set, `mouseup` not yet fired) for >800 ms, the debounce fires and applies the layout with the **current, non-final** cell rect — a genuine unfinished-resize apply reaches Caspar. Nothing checks `dragMode` before scheduling or firing. `onmouseup` (line 282) does a separate `applyIfAutoEnabled()` → `flushApply()` for the *final* state, so the end result self-corrects a moment later, but the intermediate apply still fires a real `/api/multiview/apply` with wrong geometry, causing a visible flash/jump on the live MV output and unnecessary AMCP churn. WO-190's apply lock (queues, doesn't drop) means this extra apply is not dropped — it runs serially before the next one.

**Fix:** gate the `apply-request` handler (or `scheduleApply`) on `!dragMode`, or have `onmousemove`'s `setCell` calls during an active drag use a non-apply-triggering path (`_save(false)` equivalent) and only emit `apply-request` from `onmouseup`/`ondrop`/keyboard-delete (which already call `applyIfAutoEnabled()` explicitly). The WO's own acceptance text ("respects drag-in-progress guard") describes behavior that isn't actually implemented — work-log overclaims this specific point.

### 2. WO-213 `prevLiveSceneIdByChannel` stale-key leak defeats invalidation on clear-then-restage-same-scene (not benign)
**File:** `client/lib/app-ws-handlers.js:37-60` (`maybeInvalidatePreviewOnLiveChange`), root cause on server in `src/state/live-scene-state.js:114-123` (`clearChannel` does `delete all[ch]`) and `src/api/routes-scene-preview.js:64-124` (`handlePreviewLiveClear` calls `clearChannel` for **preview** channels, then rebroadcasts `getAll()` — which now omits the cleared channel's key entirely, not just a null `sceneId`).

**Scenario:** 
1. PRV channel N has scene `sceneA` live; `prevLiveSceneIdByChannel[N] = 'sceneA'`.
2. Operator (or the pgm→prv exchange) clears PRV preview via `/api/scene/live/preview/clear` → server `delete`s channel N's key from the live map → `broadcastSceneLive` sends a `scene.live` payload **without key N**.
3. `maybeInvalidatePreviewOnLiveChange`'s loop (`for (const [channelStr, entry] of Object.entries(liveMap))`) never visits channel N because it's absent from the payload — `prevLiveSceneIdByChannel[N]` is **not reset**, it stays `'sceneA'`.
4. Scene `sceneA` gets re-staged on PRV channel N again (a plausible flow: re-preview the same look, or a pgm→prv exchange landing back on the same scene) → server does a full CLEAR + re-ADD of the PIP/border CG producers (a genuine rewrite — exactly the class of event WO-213 exists to catch) → client sees `curSceneId === prevSceneId === 'sceneA'` → `shouldInvalidate` stays `false` → **no invalidation dispatched** → the client's `lastPreviewContentSnapshot` survives → the next incremental edit sends a CG UPDATE against the server's freshly-recreated producers → **the exact stale-border symptom WO-213 was written to fix reappears**, via a narrower but real trigger path.

This isn't the "any channel absent from a later payload" catch-all the task flagged as possibly benign — because the live map is always sent in full (`getAll()`), the only way a channel goes missing is genuine deletion (explicit preview clear), and the specific replay-same-sceneId sequence is a normal operator action, not a corner case requiring unusual timing.

**Fix:** when a channel key disappears from `liveMap` entirely, delete `prevLiveSceneIdByChannel[channelStr]` too (or seed it to a sentinel like `null`/`undefined` that can never equal a real `sceneId`) so the *next* time that channel reappears — even with the same `sceneId` as before the clear — it's treated as a change.

### 3. (Minor, not scored as a "real bug") Stale comment in `template/multiview_overlay.css:68`
`/* Opt-in PGM/PRV: ... timer dock below (narrow: max(200px, 50% cell width), centered) */` describes the pre-WO-204 half-width centered dock; the actual rule two lines below (`.label-timer-dock { width: calc(100% - 16px); ... }`) is already the WO-204 full-width fix. Comment-only drift, functionally correct — flagged for hygiene, not a functional regression.

---

## Notes on honesty of investigation-status WOs (215, 190)

- **WO-215**: independently recomputed the pic-rect math from the WO's own formulas (`chromeReserveForCellLayout` + `containFillInPictureRect` at `src/engine/multiview-layout-helper.js`) — confirms the fill aspect (1.7777) exactly equals content aspect (3072/1728 = 1.7777), so H1/H2 are correctly refuted and the "awaiting owner repro" status is honest, not a cover for unfinished work. Live probe (`/api/state` → `channelMap.programResolutions`) still shows PGM1 at 3072x1728, consistent with the WO's evidence capture.
- **WO-190**: status "Planned", T190.3/T190.4 correctly left unchecked (owner repro pending). `GET /api/multiview/debug` was live-probed during this review and returns a well-formed record (cells, routes, fills, sourceChannels with crop data) — the tooling ordered by this WO genuinely works, independent of whether root cause is found.

---

## Anchors verified (file:line)

- `src/engine/multiview-apply.js:118-125` — settled-continuation chain (WO-201 fix intact).
- `src/engine/multiview-apply.js:107-108` — `layout array required` guard; pre-guarded client-side at `client/components/multiview-editor-canvas-apply.js:62-65`.
- `src/engine/multiview-apply.js:143-144` — server-side `timerScale`/`highlightTopTimer` clamp.
- `src/preview/compose-preview-ffmpeg-args.js:100` — `-r ${fps}` present (WO-201 T201.4).
- `template/multiview_master.html:219-245` vs `template/multiview_overlay.js:163-189` — `buildPlaylistRowLabel`, byte-identical.
- `template/multiview_master.html:270-272` vs `template/multiview_overlay.js:261-268` — PRV logical=physical mapping, functionally identical (`isPgm && bank==='b' ? num+100 : num`).
- `template/pip_shadow.html:19-32`, `template/pip_glow.html:20-32` — `.pip-frame { background: rgba(0,0,0,0.002); }` inside the live rule.
- `client/lib/app-ws-handlers.js:76-77`, `:118-119` — invalidation called before `applyServerLiveChannels` at both sites.
- `client/components/multiview-editor-canvas-draw.js:121-122` — full-width dock (`rect.lw - 16`), matches master.
- `client/components/multiview-editor.js:60-63,282,313` — auto-apply debounce chain (bug #1 above).
- `src/state/live-scene-state.js:114-123`, `src/api/routes-scene-preview.js:105-108` — root cause of bug #2 above.
