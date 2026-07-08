# WO-151 — Multiview timers + window sizing bugs (owner todos 2026-07-07)

**Status:** Fixed in code — awaiting operator confirmation (A151.1 / A151.2)
**Priority:** Medium-high
**Date:** 2026-07-07
**Source:** `work/todos07.07.26` (owner)

---

## 1. Bugs (owner-reported)

- [x] B151.1 **Multiview window: wrong size calculations after applying timers.** *(2026-07-08 fixed — canvas-basis rescale + MV-stage-pixel chrome constants; see diagnosis/fix plan below.)* Applying timers to the multiview perturbs the MV window/cell geometry. Locate the MV layout math (search: multiview config in `src/config/build-caspar-generator-*`, MV cell layout, timer overlay injection) and find why timer application changes size inputs (likely the timer overlay counts as a cell or resets a cached layout with different dims).
- [x] B151.2 **Timers on MV don't work correctly** *(2026-07-08 fixed — dead OSC layers pruned server-side + template stale-layer skip + WS liveness watchdog; see diagnosis below.)* (owner: "timers on mv doesnt work correctly" — behavior unspecified). FIRST: reproduce and record what "incorrectly" means (wrong time? not ticking? wrong cell? drift?) — ask the owner or capture from the box, write the observed vs expected in this WO, then fix.

## 2. Acceptance criteria

- [ ] A151.1 Applying/removing timers leaves MV window + cell geometry identical (before/after screenshots or geometry dump in work log).
- [ ] A151.2 Timers show correct, ticking values in the right cells (owner confirms on hardware).
- [ ] A151.3 Gates green after fixes.

## 3. Work log

- 2026-07-07 — WO created from `work/todos07.07.26`. B151.2 needs a symptom description before work starts.

#### 2026-07-08 — B151.2 symptom (owner)

MV timers show a **stale/stopped state instead of what's actually on screen**. The MV timers are
rendered by the **multiviewer overlay template** (CasparCG CEF template) — so the suspect chain is:
the data feed into the overlay template (CG UPDATE cadence / payload) going stale, the template not
re-rendering on update, or the overlay layer not being refreshed when timer state changes.
Investigate: what pushes timer state to the template (grep CG ADD/UPDATE for the multiview overlay
in src/), whether updates keep flowing after the timer starts, and whether the template's internal
clock free-runs vs being re-synced.

## 4. Diagnosis (2026-07-08, before fixing)

### Data path (mapped)

1. `src/engine/multiview-apply.js:289-392` — `applyMultiviewLayout()` computes per-cell geometry
   (`cell._calc`, contain-fill via `src/engine/multiview-layout-helper.js:132` `containFillInPictureRect`
   and chrome reserve via `:157` `chromeReserveForCellLayout`) and loads the overlay with
   `loadOverlayTemplate()` (`multiview-layout-helper.js:204`): `CG ADD 0 "multiview_master" 0 <json>`
   + `CG UPDATE` on layer 60 of the MV channel (confirmed in `log/caspar_2026-07-08.log:226,336,680,…`).
   The CG payload carries **only cell geometry/labels** (`cells`, `showTimersUnderLabels`) — **no timer values**.
2. Timer values are **not** pushed via CG UPDATE at all. The template
   (`template/multiview_master.html:69-106`) opens its own WebSocket to `ws://<host>:4200/api/ws`
   (`src/server/ws-server.js:285-312` sends a `state` bootstrap + `osc` snapshot on connect) and then
   renders `elapsed/duration` straight out of `oscState.channels[ch].layers[N].file` on a 150 ms
   canvas redraw (`multiview_master.html:319-413`). The server broadcasts a full `osc` snapshot on
   every `OscState` `change` (≥ every 50 ms while Caspar emits OSC) — `src/bootstrap/osc-lifecycle.js:57-62`.
3. `OscState` (`src/osc/osc-state.js`) aggregates CasparCG UDP OSC (port 6251, confirmed in
   `config/casparcg.config` `<predefined-client>`).

So the template has **no free-running clock** — it renders whatever is in `oscState`. The stale/stopped
display is stale **data**, not a stalled clock.

### B151.2 root cause — dead OSC layers are never pruned and shadow the live layer

- CasparCG only emits `/channel/N/stage/layer/L/...` OSC for layers that **currently exist** in the
  stage. After a layer is removed (CLEAR / stage teardown — e.g. the program-bank flip that clears
  bank-B layers 100+ after a transition), Caspar simply **stops sending** OSC for it; there is no
  final "empty" message.
- `OscState` keeps every layer it has ever seen: `_ensureLayer()` records `_lastOscAt`
  (`src/osc/osc-state.js:116` and `:301`) but **nothing ever reads it** — there is no layer pruning
  (only audio meters decay, `_decayStaleAudio` `:267`). Dead layers live in the snapshot forever with
  their last `file.name` + frozen `file.elapsed`.
- The overlay template picks the **highest layer number that has a file**
  (`template/multiview_master.html:123-173` `getTopLayerForPlayback`, same in
  `template/multiview_overlay.js:110`). A dead bank-B layer (e.g. 110) or any cleared high layer
  permanently outranks the actually-playing lower layer → the MV timer shows the old clip, frozen
  ("stale/stopped state instead of what's actually on screen"). The per-look layer rows
  (`collectLayerLines`, `multiview_master.html:260-317`) read `layers[pLayer]` directly and have the
  same stale-read problem.
- Secondary robustness gap: the template's WS has no liveness guard — a half-open socket after a
  server restart/network blip keeps `oscState` frozen forever (no `onclose` fires), which produces the
  identical symptom.

### B151.1 root cause — canvas-basis change is applied without rescaling stored pixel cells

- MV editor cells are stored in **pixels relative to `canvasWidth`×`canvasHeight`**
  (`client/lib/multiview-state.js`), and `toApiLayout()` (`:313`) normalizes by that basis.
- `syncMultiviewCanvasFromChannelMap` (`client/lib/app-multiview-sync.js:4-13`) runs on **every WS
  `state` message** (`client/lib/app-ws-handlers.js:36`) and on project sync
  (`client/lib/server-project-sync.js:52`); when the channel map reports a different MV/program
  resolution (this box: `programResolutions[0] = 3072×1728`, see the cell labels in
  `log/caspar_2026-07-08.log:226`), it calls `setCanvasSize(w,h)` (`multiview-state.js:221-228`),
  which **changes the normalization basis without rescaling the stored pixel cells**.
- Nothing re-applies immediately (`_save(false)`), so the wrong geometry sits latent until the next
  apply — and the "Timers under labels" checkbox triggers exactly that (`flushApply()`,
  `client/components/multiview-editor.js:80`). Result: toggling timers "resizes" the whole MV window —
  every cell scales by oldBasis/newBasis (e.g. 1920/3072 = 0.625). This is the WO's "resets a cached
  layout with different dims" hypothesis, confirmed.
- Second, smaller geometry defect: `solveCellDimensions`
  (`client/components/multiview-editor-canvas-layout.js:193`) solves aspect-locked cell dims in
  **editor-canvas pixels** while applying chrome constants (border 3 px, title 28 px, timer dock
  120–260 px) that the server applies in **1920×1080 MV-stage pixels**
  (`src/engine/multiview-layout-helper.js:157`). With a non-1920×1080 canvas the solved cell height
  reserves the wrong dock space, so after apply the contain-fill letterboxes the video instead of
  filling the cell — the error is ~5× larger with the timer dock than with plain labels, so it
  surfaces "after applying timers".

### Fix plan (implemented below)

1. **Server:** prune OSC layers with no OSC for `osc.layerStaleTimeoutMs` (default 10 s) in
   `OscState._flushEmit()`/`getSnapshot()` — dead layers drop out of the WS feed.
2. **Templates:** skip layers whose `_lastOscAt` is stale relative to the snapshot `updatedAt`
   (shared helper in `template/multiview-playback-osc.js`), and add a WS liveness watchdog
   (resync request after 12 s silence, force-reconnect after 30 s).
3. **Client:** `setCanvasSize()` rescales existing cell pixel rects so the normalized layout — and
   therefore the applied MV geometry — is invariant under canvas-basis changes; `solveCellDimensions()`
   converts to MV-stage pixels before applying chrome constants so client and server agree.

#### 2026-07-08 — verification (orchestrator; agent interrupted at final lint)

`node --test tools/smoke/smoke-multiview-timers-geometry.test.js` green (part of a 34/34 run with
the other WO-150/152 smokes); `npx eslint --quiet` 0 on all touched files
(`src/osc/osc-{state,config}.js`, `client/lib/multiview-state.js`,
`client/components/multiview-editor-canvas-layout.js`); `node --check` OK on both templates.
Takes effect on next service restart (server prune + templates reload with Caspar CG).
A151.1/A151.2 operator checks remain: apply/remove timers → geometry identical; timers tick the
actually-playing clip, survive a bank flip and a server restart (watchdog reconnect).
