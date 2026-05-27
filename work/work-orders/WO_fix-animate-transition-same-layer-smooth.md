# Work order: Fix `+ Animate` transitions (same on-air layer, synced PLAY/FILL, PRV exchange)

## Goal

Make **`{TYPE} + Animate`** (and legacy **`+ MERGE`**) look transitions work on the **same physical Caspar layer that is on program** — **no bank A/B (+100)** — with a single smooth commit window:

1. Prepare on the **on-air** layer (not inactive bank, not raw logical `N` when bank B is active).
2. **`MIXER FILL`** animated over **`$transition`** (frames + tween).
3. **`PLAY`** with the **same** transition type, duration, and tween.
4. One **`MIXER {ch} COMMIT`** batch with **`PLAY`** so clip + geometry tween together.
5. After the transition window: **cleanup** (ghost bank, exited layers, border) then **PGM → PRV** bus exchange as today.

This WO is **separate** from bank crossfade (`WO_fix-ab-bank-transition-layer-order.md`). Plain **MIX/WIPE** (no `+ Animate`) keeps the dual-bank opacity path.

---

## Background / current problem

Today `isLayerAnimateTakeTransition()` (`scene-transition.js`) sets `isMergeTransition` and:

| Current behavior | Why it fails |
|------------------|--------------|
| `pLayer = layer.layerNumber` (logical **N**) | After a banked take, PGM is often on **`N+100`**; animate still loads **`N`** → wrong / invisible / “cut” |
| `LOADBG … MIX <dur>` + `MIXER OPACITY <dur> DEFER` on same layer | Two competing fades; mixer opacity fights Caspar FG/BG mix |
| `fillTail = '0'` (immediate FILL) | Geometry jumps; comment in code says animated FILL was visible on-air — prep model was wrong layer |
| `programLayerBank → 'a'` after take | Does not move on-air clip before prepare |
| No bank crossfade (`shouldRunBankCrossfade = false`) | Correct intent, but layer index is wrong |

**Related:** `docs/reference/amcp-pgm-look-take-pipeline.md` § MERGE / +Animate — needs rewrite when this WO lands.

---

## Product contract (operator-visible)

- **`MIX + Animate`**, **`WIPE + Animate`**, etc. = **same-layer** transition on whatever is **currently on PGM** for that logical layer.
- **Not** a bank swap; **not** the incoming-above/outgoing-above opacity rules from WO_fix-ab-bank.
- Preview bus (PRV): after PGM take finishes, previous PGM look is staged on the preview channel per routing (`routes-scene.js` PGM/PRV path) — **hard cut** on PRV is OK; PGM must carry the smooth animate.

---

## Desired AMCP semantics (per incoming layer)

**Example:** PGM ch `1`, logical layer `10`, **bank B on air** → physical **`1-110`** shows `example1.mov`. Incoming look same layer, `example2.mov`, `defaultTransition`: `MIX + Animate`, duration **`75`**, tween **`linear`**.

Let `$T` = transition type (strip `+ Animate` / `+ MERGE` → `MIX`), `$D` = duration frames, `$tw` = tween.

`pOnAir = physicalProgramLayer(10, activeBank)` → **`110`**.

### Phase 1 — Prepare (no COMMIT yet)

Target **only** `{ch}-{pOnAir}`.

```text
LOADBG 1-110 "example2.mov" LOOP …          # no MIX on LOADBG (transition only on PLAY)
MIXER 1-110 FILL <x> <y> <sx> <sy> $D $tw   # animated FILL, same duration as PLAY
MIXER 1-110 ROTATION … 0                    # immediate if needed
MIXER 1-110 KEYER / VOLUME / effects …      # policy: immediate vs DEFER — see implementation notes
```

**Do not** send `MIXER OPACITY <dur>` on the same layer for this path (Caspar clip transition owns the dissolve).

**Do not** prepare on `1-10` while `1-110` is on program.

### Phase 2 — Smooth take (single sandwich)

After short preroll (if needed for LOADBG decode), **one sequential chain**:

```text
MIXER 1 COMMIT
PLAY 1-110 "example2.mov" MIX $D $tw
MIXER 1 COMMIT
```

(`PLAY` may use minimal form `PLAY 1-110` if clip already in LOADBG — must still include **`MIX $D $tw`** per Caspar rules.)

FILL tween and PLAY transition must use the **same** `$D` and `$tw`.

### Phase 3 — Wait + cleanup

- Wait **`$D` frames** (same `fadeMs` / `fadeClockStart` pattern as bank crossfade).
- **Teardown** on layers that **left** the look (and ghost **`N+100`** if active bank was A — see below).
- **Do not** flip `programLayerBank` for animate takes (stay on current bank).
- Clear stale content on the **inactive** bank slot for this logical layer (`N` vs `N+100`) so the next banked MIX take does not flash old media.

### Phase 4 — PGM → PRV (unchanged contract, timing)

From `routes-scene.js` (2-bus PGM/PRV):

1. Optional: stage incoming on PRV with **`forceCut`** before PGM (staging only).
2. Run **this** animate path on **PGM**.
3. When PGM take completes (including animate wait + teardown): **`clearSceneProgramLookStackLayers(prv)`** + hard-cut **previous PGM** look onto preview bus (`forceCut: true` on PRV).

Document the resolved preview channel in logs (`bus1` / “ch2” per site `channel_map`) — do not hard-code channel numbers in engine code.

---

## Implementation tasks

### A) Routing / flags (`scene-take-lbg.js`, `scene-take-lbg-jobs.js`)

1. Rename internally for clarity (optional): `isMergeTransition` → `isAnimateSameLayerTransition` (keep alias for logs).
2. **`shouldRunBankCrossfade`** stays `false` when animate — no change.
3. **`pLayer` for animate:** `phys(layerNumber, activeBank)` — **never** bare `layer.layerNumber`.
4. **`programLayerBankByChannel`:** on animate take completion, **do not** force `'a'`; leave bank unchanged.
5. Pass `activeBank` into `buildTakeJobs` (already present after recent work).

### B) Job building (`scene-take-lbg-jobs.js`)

1. **LOADBG:** clip + loop/seek/AF; **no** `loadOpts.transition` on animate path (transition on **PLAY** only).
2. **FILL:** `fillTail = String(globalT.duration)` + tween when animate (not `'0'`).
3. **Remove** animate branch `MIXER OPACITY ${targetOpacity} ${globalT.duration}` (and DEFER thereof).
4. **`playPlan`:** ensure `diffCasparLayerPlan` / play opts include `transition`, `duration`, `tween` from `baseTypeStripAnimateSuffix(globalT.type)`.
5. **No** `incomingStartsHidden` / bank crossfade fields for animate jobs.

### C) AMCP pipeline (`scene-take-lbg-amcp-pipeline.js`)

1. New branch: `isMergeTransition && takeJobs.length` (replace current merge PLAY-only branch):
   - Prep: `LOADBG` per job (existing), then mixer batch with **animated FILL** (policy: FILL line **not** deferred, or all prep immediate before sandwich — validate on hardware).
   - Preroll: keep ~180 ms when LOADBG just issued; tune if needed.
   - **Sequential:** `[MIXER ch COMMIT, …PLAY lines with MIX $D $tw…, MIXER ch COMMIT]`.
2. **Do not** use bank `crossfadeLines` for animate.
3. **`mergeMixerExtras`:** revisit outgoing-only `OPACITY 0` DEFER — either drop for layers being **replaced** on the same physical slot, or keep only for **true exit** layers (not in incoming look). Avoid double-fade with PLAY MIX.

### D) Teardown (`scene-take-lbg-teardown.js`, `scene-exit-layers.js`)

1. Exiting layers: fade/stop on **`phys(ln, activeBank)`** for animate path (not merge’s logical-only `ln`).
2. After animate: clear **ghost** `ln + PGM_BANK_B_OFFSET` if it still holds stale FG from old banked takes.
3. Reuse `fadeClockStart` / `fadeMs` wait before STOP/CLEAR.

### E) PRV / API (`routes-scene.js`)

1. No change required to exchange **semantics** if PGM animate completes before `startPreviewExchange()` — verify `onProgramTransitionStarted` / teardown ordering so PRV is not started mid-PGM-fade.
2. Log preview channel id on exchange for field debug.

### F) Docs

- `docs/reference/amcp-pgm-look-take-pipeline.md` — replace § MERGE / +Animate with phases above (on-air layer, PLAY+FILL same `$D`, COMMIT sandwich).
- `work/amcp-revision.md` — new subsection under pipeline 1; mark old merge opacity DEFER as **removed**.
- Cross-link from `WO_fix-ab-bank-transition-layer-order.md` (“plain MIX only”).

---

## Out of scope (this WO)

- Changing banked MIX (no `+ Animate`) behavior.
- Animated global border on animate path (optional follow-up; may keep linked fade if low risk).
- PRV staging before PGM with animate (PRV stays **forceCut**).
- Legacy `scene-take.js` dual-bank path (unused by API).

---

## Acceptance criteria

1. **Bank B on air:** PGM shows `1-110` → take with `MIX + Animate` → logs show **`LOADBG 1-110`**, **`MIXER 1-110 FILL … 75 linear`**, **`PLAY 1-110 … MIX 75 linear`**, **no** `LOADBG 1-10` / **no** `MIXER 1-110 OPACITY 75` DEFER-only fade.
2. **Bank A on air:** same with `1-10` — symmetric.
3. **Visual:** smooth dissolve + geometry tween; no flash to wrong layer; no ~50% dip from paired mixer opacity.
4. **After transition:** ghost inactive bank cleared; previous PGM on preview bus (PRV) per routing.
5. **Regression:** plain `MIX` (no `+ Animate`) still uses bank crossfade direction logic.

---

## Verification

1. Extract AMCP from `logs_lap/logs.md` after two takes: banked MIX then `MIX + Animate` on same project.
2. Confirm physical layer numbers match `programLayerBankByChannel` for the channel.
3. Optional: frame grab mid-transition — composite stable (no dip).

---

## Work log

### 2026-05-27 — Agent (implementation)

**Code:** `scene-take-lbg-jobs.js` — on-air `pLayer`, LOADBG without MIX, animated FILL tail, PLAY plan with MIX+duration, no animate opacity tween. `scene-take-lbg-amcp-pipeline.js` — COMMIT/PLAY/COMMIT sandwich via `serializeClipCommandPlan`. `scene-take-lbg.js` — bank unchanged on animate; clear inactive bank after take. `scene-take-lbg-teardown.js` — ghost clear on `inactiveBank`, exits on both banks. `routes-scene.js` — log prv channel on exchange.

**Docs:** `amcp-pgm-look-take-pipeline.md`, `amcp-revision.md`.

**Field verify:** AMCP log on bank B on air + `MIX + Animate` take.

## Instructions for next agent

1. Implement **on-air `pLayer`** + **PLAY with `$D`** + **FILL `$D`** + **COMMIT sandwich** first; test on bank B on air.
2. Remove animate **`MIXER OPACITY <dur>`** and **LOADBG MIX** double-transition.
3. Fix teardown ghost `N+100` clear; then verify PRV exchange timing in `routes-scene.js`.
4. Update docs and paste a sample log block into this WO work log.
