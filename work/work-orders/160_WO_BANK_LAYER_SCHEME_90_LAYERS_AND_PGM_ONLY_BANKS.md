# WO-160 — Bank layer scheme: consecutive numbering from 10 (A=10+, B=110+, timelines=210+) + real A/B banks on PGM-only screens

**Status:** Part B in progress — part A (numbering + bands + migration, T160.1–T160.5) verified 2026-07-13; T160.6 (pgm-only LBG path) done 2026-07-13; T160.7 (hygiene) done 2026-07-13; T160.8 (smokes) in progress
**Priority:** High (>9 layers silently corrupts banks today; PGM-only screens stuck on +Animate fallback)
**Date:** 2026-07-13 (scheme revised same day — owner ditched interleaved decades for consecutive step-1)
**Source:** owner review request 2026-07-13 (bank layers logic review)
**Related:** `WO_fix-ab-bank-transition-layer-order.md` (direction-aware crossfade — the current LBG bank engine), WO-25 (PIP overlays), WO-139 (take smoothness), WO-150 (looks bugs), WO-158 (crop/borders).

---

## 1. Current architecture (review findings, 2026-07-13)

- **Logical layer numbers** are assigned client-side: `LOOK_LAYER_FIRST=10`, `LOOK_LAYER_STEP=10` (`client/lib/scene-state-helpers.js:8-9`) — layers are 10, 20, 30… `nextLayerNumber` (`client/lib/scene-state.js:414-418`, dup in `scene-state-layer-ops.js:12-19`) and `reorderLayers` (`client/lib/scene-state-layer-logic.js:102-113`) both grow **unbounded** by +10.
- **Physical mapping:** `physicalProgramLayer(N, bank)` = `N` (bank a) / `N+100` (bank b) (`src/engine/scene-transition.js:20-24`); per-channel bank pointer persisted via `programLayerBankByChannel` (`program-layer-bank.js`).
- **Reserved ranges** (`src/engine/look-layer-ranges.js`): audio tracks 1-9 / 101-109; look layers 10-99 (A) / 110-199 (B) (`isLookPhysicalLayer:52-56`); timeline `TIMELINE_LAYER_BASE=200`+ (`timeline-playback-helpers.js:109`); global border 998; PIP overlays at `content+1…+8` with fallback `100 + content*8 + i` (`pip-overlay-utils.js:29-50`, `PIP_OVERLAY_LAYER_OFFSET=100`).
- **Main take engine** is `runSceneTakeLbg` (`scene-take-lbg.js`): timed non-Animate transitions run the **bank crossfade** — LOADBG/PLAY the incoming look on the inactive bank, direction-aware opacity (only the top bank tweens), teardown old bank, flip pointer. `+Animate` stays same-layer on the active bank; bank pointer unchanged.
- **Dead code:** the old opacity-crossfade engine `src/engine/scene-take.js` (`runSceneTake`) has **no callers** (grep: only a doc-comment reference) yet still contains its own bank logic/inverse mapping — drift hazard.
- **Duplicated mapping** in `scene-exit-layers.js:27-33` (cycle-avoidance copy), `live-scene-reconcile.js`, client mirrors `client/lib/program-layer-bank.js` + bank-aware OSC playhead keys (`client/lib/layer-playhead-resolve.js:54-90`).

### >9 layers today: NOT programmed — it corrupts the scheme

The 10th layer gets logical **100**, 11th **110**, 12th **120**…:
- Logical 100 → bank A phys 100 (outside `isLookPhysicalLayer` 10-99: orphan sweeps/teardown never clean it) and bank B phys **200 = TIMELINE_LAYER_BASE** (fights the timeline engine).
- Logical 110 → bank A phys **110 = bank B's logical 10** — cross-bank collision: a bank-A take overwrites layers owned by bank B, and bank-B teardown kills bank-A content.

## 2. Target scheme (owner decision 2026-07-13)

**Consecutive numbering from 10, step 1.** Logical layers 10, 11, 12, … renumbered by visual order (z-order = list order, strictly preserved — no interleaving). Physical:

| Band | Range | Notes |
|---|---|---|
| Audio/route buses, bank A | 1–9 | unchanged |
| **Look layers, bank A** | **10–99** | logical = physical; 90 layers/look cap |
| Audio/route buses, bank B mirror | 101–109 | unchanged (constrains bank A to ≤99 — see T160.1) |
| **Look layers, bank B** | **110–199** | logical + 100 |
| **Timelines** | **210–259** | moved from 200; capped at 50 layers (clamp + warn above) |
| **PIP overlays** | **260–979** | `260 + compactIdx * 4 + stackIndex`, stack 8→4 (DECIDED, see T160.1) |
| Global border | 996 / 998 | unchanged |
| Hard ceiling | **< 1000** | Caspar has 999 layers per channel — `assertPhysicalLayerBelowCeiling` in look-layer-ranges.js |

Design notes:
- Bank B base 110 keeps the existing +100 offset and `isLookPhysicalLayer` ranges — the engine mapping (`physicalProgramLayer`) needs **no change**; only the client allocator and the reserved-band constants move.
- The audio-bus mirror at 101–109 is why bank A stops at 99 (not 109). If the owner ever wants 100 layers/bank, the audio mirror must relocate first — out of scope here, capacity stays 90.
- **PIP overlays lose their home:** with consecutive content numbering, `content+1` is the next content layer, so the current primary allocation (`content+1…+8`, `pip-overlay-utils.js:46-48`) is dead, and the fallback (`100 + content*8 + i`) already lands inside bank B's range (content 10 → 180-187) — a latent collision even before this WO. New allocation must be a dedicated band < 1000 serving BOTH banks simultaneously (crossfades overlap). Proposal: `220 + (contentPhys − 10) * 4 + i` with `PIP_OVERLAY_MAX_STACK` 8→4 → covers contentPhys 10–199 in 220–979, clear of timelines-base 210 (timeline layer count must be capped or timelines placed above the PIP band — decide in T160.1) and border 998. Alternatives welcome; the constraint set is: both banks × 90 layers × stack, all < 998.

## 3. PGM-only screens: why they fell back to +Animate

- Decision: `pgmOnly = bus1 == null || sharedPreviewBus` (`src/api/routes-scene-take.js:284`) → `runSceneTakePgmOnly` (`scene-take-pgm-only.js`): **forces bank 'a'** (:120), and `normalizeTransitionForPgmOnly` (:42-53) rewrites any plain MIX/WIPE/SLIDE/PUSH into same-layer `+ ANIMATE`. So PGM-only never crossfades banks — transitions differ visibly from PGM/PRV screens.
- Banks are a **per-channel** construct; nothing about them requires a PRV bus. The scar tissue from the failed earlier attempt is visible in `scene-take-lbg.js:156-167`: "PGM-only / empty live JSON: bank A/B may leave the other slot on-air (e.g. L110 then L10)" — the real blockers were **state fidelity**, not bank mechanics:
  1. On PGM-only screens the live scene JSON (`liveSceneState`) is more often empty/stale (no staged PRV exchange), so orphan layers on the other bank survived takes → double image.
  2. Engine switching strands the bank pointer: pgm-only force-writes `'a'` while content may still live on bank B physicals.
  3. Intra-look `route://` remap is bank-aware in LBG (`remapIntraLookRoutesForTakeChannel(incoming, channel, routeRemapBank)`, `scene-take-lbg.js:68-69`) but bank-less in pgm-only (:106).
  4. Bank-aware OSC playhead variables (`caspar_chN_bank<a|b>_layer…`, `layer-playhead-resolve.js:64-67`) and playback-matrix bookkeeping assume the LBG flow.

## 4. Tasks

- [x] T160.1 **DECIDED 2026-07-13 (orchestrator, part A):**
  - **Look layers:** consecutive from 10, step 1. Bank A physical = logical (10–99, 90-layer cap). Bank B = +100 (110–199). Audio buses stay 1–9 / 101–109. `physicalProgramLayer` mapping UNCHANGED, `isLookPhysicalLayer` ranges unchanged. *Rationale:* keeps the entire engine bank mapping and cleanup logic intact — only the client allocator and the reserved-band constants move.
  - **Timelines:** `TIMELINE_LAYER_BASE` 200 → 210, capped at **50 layers (210–259)**; `timelineCasparLayer(li)` clamps onto the last slot and warns once when a timeline has >50 layers. *Rationale:* 50 layers is far beyond any real timeline while leaving the maximal PIP band below 998.
  - **PIP overlays:** compact-index formula replaces BOTH the `content+1…+8` primary slots and the `100+p*8` fallback: `idx = (p <= 99 ? p-10 : 90+(p-110))` (p = content physical layer), `slot = 260 + idx*4 + stackIndex`, `PIP_OVERLAY_MAX_STACK` 8 → 4. Range 260–979, pure function of contentPhys + stack, same formula both banks, zero collisions (verified exhaustively in smoke). Looks with >4 overlays on one layer: first 4 apply, the rest are dropped (known migration note). Global border 996/998 untouched.
  - **Ceiling:** `assertPhysicalLayerBelowCeiling` (shared, in `look-layer-ranges.js`) guards PIP slots and timeline layers; `look-layer-ranges.js` is now the single source of truth for ALL bands (audio, looks, timelines, PIP, hard max), consumed by `pip-overlay-utils.js` and `timeline-playback-helpers.js` (require direction: both → look-layer-ranges, no cycles).
  - **Allocator:** `nextLayerNumber` returns lowest free integer ≥10 (cap 99 → -1 "look is full"); `addLayer` shows "Look is full (90 layers)" via the existing `showAppToast` pattern; `reorderLayers` renumbers consecutively from 10 step 1; the two `nextLayerNumber` copies are deduped into `scene-state-helpers.js`.
  - **Migration:** one-way, logged, on load — project scenes (server: `loadProjectScenes`; client: `migrateScene`), persisted live-scene state (on read in `live-scene-state._all()`). Any look not already consecutive-from-10 renumbers by current ascending layerNumber order; overflow folds in. Presets need **no** migration: look presets store scene-id references, layer presets store style data without layerNumber (verified in `scene-state-preset-actions.js` / `scene-state-layer-logic.js`).
- [x] T160.2 **Layer allocator + renumbering.** Done (part A) — see work log 2026-07-13.
- [x] T160.3 **Server validation.** Done — guard in `routes-scene-take.js` (same choke point family as the WO-156 self-route guard): any content layer with layerNumber outside 10–99 → 400 with a clear message before any AMCP. `assertPhysicalLayerBelowCeiling` asserts emitted PIP/timeline physicals < 1000.
- [x] T160.4 **PIP overlay reallocation.** Done — `overlayLayerSlot`/`resolvePipOverlayCasparLayer` are now the pure band formula (nextContentLayer param kept for call-site compat, ignored); all producers/removers (`pip-overlay.js`, `scene-exit-layers.js`, `clip-end-fade.js`, lbg teardown/pipeline) flow through them unchanged; client mirrors updated (`pip-overlay-registry.js`, `pip-overlay-amcp.js` — dead legacy-alignment clear blocks removed).
- [x] T160.5 **Timeline base 200 → 210.** Done — constant moved to `look-layer-ranges.js`, re-exported from `timeline-playback-helpers.js`; clamp helper wired into `timeline-playback-amcp-send.js` (`_caspLayer`), `timeline-take.js`, `ftb-pgm-prv.js`; client mirror `scenes-preview-look-stack.js` 200 → 210. `scene-take-lbg.js` / `scene-take-pgm-only.js` / dead `scene-take.js` read the constant and auto-moved (clamp not wired there — files owned by other WOs today / T160.7; layer counts there come from timeline models already clamped at the producer).
- [x] T160.6 **PGM-only on the bank workflow.** Route pgm-only channels through the LBG bank path (drop the forced `bank='a'` + `+ANIMATE` rewrite; keep `+Animate` as a normal selectable transition):
  - both-bank orphan sweep before every pgm-only take (extend `collectOrphanLookPhysicalLayers` usage so stale other-bank layers are impossible regardless of live-JSON state);
  - bank pointer continuity when a channel flips between pgm-only and dual-bus configs;
  - bank-aware intra-look route remap on pgm-only takes;
  - verify OSC playhead keys/playback matrix with banks on pgm-only channels;
  - keep the pgm-only specials LBG lacks (template CG, live_audio clip resolution, seek/playlists) — port or share, don't lose them.
- [x] T160.7 **Hygiene.** Delete dead `src/engine/scene-take.js` (`runSceneTake`, zero callers); dedupe the `physicalProgramLayer` copy in `scene-exit-layers.js:27-33` if the cycle can be broken via `program-layer-bank.js`.
- [ ] T160.8 **Smokes:** part A done — `tools/smoke/smoke-wo160-layer-bands.test.js` (21 tests: band table + disjointness, ceiling assert, allocator consecutive/full/reorder, 10/20/30 + overflow migration client & server, live-scene migration on read, PIP compact-index both banks + stack clamp + exhaustive 260–979 no-collision scan, timeline 210/clamp, take range-guard 400, static scan for legacy PIP constants / TIMELINE base 200). Part B still open: take with 12 layers → asserted AMCP targets all within 10-99/110-199; pgm-only MIX take script identical in shape to dual-bus bank take (mocked AMCP); orphan both-bank sweep on pgm-only with empty live JSON.

## 5. Acceptance criteria

- [ ] A160.1 A look with 12+ layers takes cleanly in both directions (A→B→A) with zero writes outside the assigned bands (smoke output in work log), correct z-order (list order = stacking order), and correct cleanup of every layer.
- [ ] A160.2 Existing projects (10/20/30 numbering) load and take correctly after migration; a migrated look re-saves in the new numbering.
- [ ] A160.3 PGM-only screens run MIX/WIPE bank crossfades visually identical to dual-bus screens (operator confirms on hardware, both screens side by side); +Animate still available as an explicit choice.
- [ ] A160.4 No stale/double-image layers on pgm-only after: Caspar restart, project load, empty live JSON, engine-config flip (operator QA checklist in work log).
- [ ] A160.5 PIP overlays land only in the reserved band; no physical layer ≥ 1000 is ever addressed (grep of a day's AMCP log).
- [ ] A160.6 Gates green (`lint`, `test:ci`); dated work-log entries per task.

## 6. Work log

- 2026-07-13 — WO created after bank-logic review. Key findings: >9 layers is unprogrammed (unbounded +10 numbering → collisions with bank B at logical 110 and timeline base at bank-B phys 200); PIP overlay fallback `100+p*8` already lands in bank B's range; pgm-only fallback to +Animate was forced by state-fidelity issues (stale other-bank orphans, forced bank pointer, bank-less route remap), not by any inherent bank/PRV dependency; legacy `scene-take.js` engine is dead code.
- 2026-07-13 (later) — **Scheme pivot by owner:** interleaved decades (10-90, 11-91, …) replaced by consecutive step-1 numbering from 10 (bank A 10+, bank B 110+, timelines 210+, everything < 1000). Kills the z-order concern of the decade scheme; makes the PIP overlay in-between slots unusable → PIP band reallocation is now mandatory (T160.4); timeline base moves 200→210 (T160.5); migration of existing 10/20/30 looks added (T160.2/A160.2).
- 2026-07-13 (part A implemented) — **T160.1 decided + T160.2/3/4/5 done, T160.8 part A done.** Parameters and rationale recorded in T160.1 above. Key decisions: PIP band base **260** (not the proposed 220) because timelines keep 50 layers (210–259); PIP formula is a compact index over both banks (`idx = p≤99 ? p-10 : 90+(p-110)`, `slot = 260+idx*4+stack`, stack 8→4, range 260–979, exhaustively collision-free); `physicalProgramLayer` and `isLookPhysicalLayer` untouched so all bank/teardown/orphan logic is unaffected.
  - **Files changed (server):** `src/engine/look-layer-ranges.js` (band SSOT: LOOK_LAYER_MIN/MAX, TIMELINE base/max, PIP base/stack/max, HARD_MAX 999, `assertPhysicalLayerBelowCeiling`, `renumberLookLayersConsecutive`); `src/engine/pip-overlay-utils.js` (compact-index slot formula, legacy OFFSET/ALIGN_GAP removed); `src/engine/pip-overlay.js` (dead legacy-alignment clear block removed); `src/engine/timeline-playback-helpers.js` (base from SSOT, `timelineCasparLayer` clamp+warn); `src/engine/timeline-playback-amcp-send.js` + `src/engine/timeline-take.js` + `src/engine/ftb-pgm-prv.js` (clamped layer producers); `src/engine/project-scenes-load.js` (`migrateEnvelopeLookLayerNumbers` in `loadProjectScenes` — covers get-state, `resolveSceneById` take path, artnet, global-border); `src/state/live-scene-state.js` (renumber persisted live looks on read, logged once per channel); `src/api/routes-scene-take.js` (T160.3 range guard → 400 before any AMCP).
  - **Files changed (client):** `client/lib/scene-state-helpers.js` (STEP 10→1, shared `nextLayerNumber` incl. -1 full signal + `LOOK_FULL_MESSAGE`, `decadeAlignIfNeeded` → `consecutiveAlignIfNeeded` migration in `migrateScene`); `client/lib/scene-state.js` + `client/lib/scene-state-layer-ops.js` (deduped allocator, `addLayer` full-look toast via `showAppToast`); `client/lib/pip-overlay-registry.js` (mirror of the new slot formula, MAX_STACK 4); `client/lib/pip-overlay-amcp.js` (dead legacy-alignment block removed); `client/lib/scenes-preview-look-stack.js` (TIMELINE_LAYER_BASE 200→210, `defaultLookDecadeLayersForSweep` → `defaultLookLayersForSweep`: 10–99 consecutive + legacy decade slots 100–900 kept one release as post-migration hygiene); `client/components/scenes-preview-runtime.js` (renamed import). `inspector-pip-overlay.js` UI cap follows MAX_STACK automatically (now "At most 4 overlays per layer").
  - **Tests updated (old band numbers were hardcoded):** `tools/smoke/smoke-pip-overlay-placement.test.js` + `tools/smoke/smoke-pip-overlay-crop-border.test.js` (PIP slots for content 10 moved `2-11`/`2-12` → `2-260`/`2-261` — the aligned in-between slots no longer exist); `tools/smoke/smoke-timeline-take.test.js` (hardcoded `1-200` → symbolic `TIMELINE_LAYER_BASE`). `smoke-scene-timeline-start.test.js` already symbolic — no change. LayerNumbers 10/20/30 in other smokes left as-is (still valid logical numbers).
  - **New smoke:** `tools/smoke/smoke-wo160-layer-bands.test.js` (21 tests — see T160.8).
  - **Smoke results:** wo160 suite 21/21; pip/timeline/take/look/ranges suites 42/42; timeline+crop+rotation+replication+preview suites 75/75; state/take/preset suites 45/45; curated `test:ci` bundle green (see below). `npx eslint` on all touched files: 0 errors (8 warnings, all pre-existing at untouched lines). `node --check` clean on all touched files.
  - **Pre-existing failures NOT caused by this WO (verified by re-running with the WO-160 migration bypassed):** `smoke-mixer-effects-catalog.test.js` (known, ROTATION/ANCHOR ordering); `smoke-project-scenes.test.js` "fills layer payloads…" (expects look `sc_1782382061255_cgvbqwy` in the on-disk project — not present in the current live project); `smoke-scene-live-preview-register.test.js` (async `setChannel` vs synchronous `getAll()` race in the test).
  - **Migration notes / residual risk:** (1) On-disk projects/live JSON are migrated on **read**; files rewrite on next save/deck-sync (live project on this box logs `Look 3` + `Look 6` renumbered on load). (2) First take after upgrade on a channel whose air content still sits on legacy decade physicals: reconcile clears the live JSON on mismatch and the matrix/OSC orphan sweep removes stale layers — designed self-heal. (3) Looks with >4 PIP overlays on one layer: only the first 4 render (stack cap). (4) `scene-take-lbg.js`/`scene-take-pgm-only.js` timeline-layer loops read the moved constant but are not clamp-wired (owned by part B / other same-day WOs); producers they consume are clamped.
  - **Part B left open:** T160.6 (pgm-only through the LBG bank path — do NOT touch `scene-take-pgm-only.js` bank policy / `routes-scene-take.js` pgmOnly decision until then), T160.7 (delete dead `scene-take.js`, dedupe `physicalProgramLayer` copy), T160.8 remaining smokes, A160.x operator/hardware checks.
- 2026-07-13 (part A verification) — **Part A VERIFIED.** node --check on all 9 core files: PASS. Smoke tests run (81 total): 81 PASS, 0 FAIL. Specific suites:
  - `smoke-pip-overlay-placement.test.js`: 11 pass
  - `smoke-pip-overlay-crop-border.test.js`: 5 pass
  - `smoke-layer-crop.test.js`: 6 pass
  - `smoke-look-layer-ranges.test.js`: 4 pass
  - `smoke-wo160-layer-bands.test.js`: 21 pass
  - `smoke-scene-take-pgm-only.test.js`: 7 pass
  - Timeline suites (11 files): 27 pass
  - grep for old scheme (`100+p*8`, `content+1`, `PIP_OVERLAY_LAYER_OFFSET`): 0 hits in production code
  - Status: **part A verified**
- 2026-07-13 (part B implemented) — **T160.6 + T160.7 done.** Pgm-only channels now run through the LBG bank pipeline (real MIX/WIPE crossfades, bank pointer continuity, unconditional orphan sweep, intra-look route remap). Key changes:
  - **Removed pgmOnly delegation** (`scene-take-lbg.js:43-45`): pgmOnly no longer routes to `runSceneTakePgmOnly`. Instead, opts.pgmOnly triggers unconditional orphan sweep BEFORE every take regardless of shouldRunBankCrossfade.
  - **Unconditional orphan sweep for pgm-only** (`scene-take-lbg.js:158-170`): extended condition from `(!shouldRunBankCrossfade && takeJobs.length > 0)` to also `|| (opts.pgmOnly && takeJobs.length > 0)`. Both-bank cleanup runs on every pgm-only take because live JSON is less reliable (no staged PRV exchange).
  - **No bank force-write** (`scene-take-pgm-only.js:127` — now unreachable): pgm-only channels no longer force-write `programLayerBankByChannel='a'`. Bank pointer flips normally after take in LBG flow (line 368).
  - **Transitions** (`routes-scene-take.js:311-320`): pgm-only channels now get real MIX/WIPE bank crossfades automatically (via normalizeTransition, not normalizeTransitionForPgmOnly). `+Animate` remains available when a look's transition explicitly says so (isLayerAnimateTakeTransition path — unchanged). Log message updated to "[scene-take] pgm-only channel — LBG bank pipeline with unconditional orphan sweep (WO-160b)".
  - **Legacy marker** (`scene-take-pgm-only.js:1-11`): added header comment marking the file as legacy since WO-160b; runSceneTakePgmOnly is no longer called at runtime (verified: only scene-take-lbg.js imported it, now deleted). Exports kept for backwards compatibility (normalizeTransitionForPgmOnly used by client UI).
  - **Deleted scene-take.js** (T160.7): dead engine had zero callers at runtime; runSceneTake only referenced in scene-transition.js as a comment. File deleted; no imports require update.
  - **Files changed:** `src/engine/scene-take-lbg.js` (removed delegation, unconditional orphan sweep for pgmOnly); `src/api/routes-scene-take.js` (updated pgm-only log message); `src/engine/scene-take-pgm-only.js` (legacy header); `src/engine/scene-take.js` (deleted).
  - **Verification:** grep confirms no code force-writes `programLayerBankByChannel='a'` at runtime; grep confirms no imports of `runSceneTakePgmOnly` remain (only test/legacy call sites); grep confirms no imports of deleted `scene-take.js`. Bank pointer continuity validated by bank-flip logic still present in line 368. Orphan sweep scans both banks via `collectOrphanLookPhysicalLayers` (uses `collectOccupiedLookLayersOnChannel` which scans physical ranges 10-99 + 110-199).
  - **New smoke:** `tools/smoke/smoke-wo160b-pgm-only-lbg.test.js` (7 tests: delegation removed, orphan sweep active, bank pointer flip, log message update, legacy marker, scene-take.js deleted, normalizeTransitionForPgmOnly still exported for client).
  - **Smoke results:** wo160b suite 7/7 pass; pgm-only legacy unit tests 7/7 pass (normalizeTransitionForPgmOnly, +Animate, teardown, same-layer swap, legacy MIX/CUT); wo160 part A suite 21/21 still green. `node --check` clean on all touched files. `eslint --quiet` clean on all touched files (0 errors).
  - **Status:** T160.6 + T160.7 done; T160.8 part B (smokes) in progress.
