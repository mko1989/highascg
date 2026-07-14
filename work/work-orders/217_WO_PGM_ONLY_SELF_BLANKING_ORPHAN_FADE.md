# WO-217 — PGM-only merge take fades out the layer it just played into (screen blanks, sticky opacity 0)

**Status:** Planned
**Priority:** Critical (live outage 2026-07-14 ~15:50 — screen 2 blank across takes AND a Caspar restart; manually recovered 16:0x via `MIXER 3-10 OPACITY 1`)
**Date:** 2026-07-14
**Source:** owner: "the pgm only screen stopped working... i even restarted caspar and it stays blank..."
**Related:** WO-160b (pgm-only LBG + unconditional sweeps), WO-209 (bankless mode — same family: bank/exit logic vs same-layer staging).

---

## 1. Evidence (caspar log ≥15:50 + live mixer query)

```
PLAY 3-10 route://1 MIX 25 linear      ← incoming look starts on 3-10
MIXER 3-10 OPACITY 0 25 linear         ← same take's orphan/exit fade zeroes THE SAME LAYER
PLAY 3-10 TESTOWE/FOREST_JESTER-DV ... ← every later take plays into the invisible layer
```
Live query: `MIXER 3-10 OPACITY` → `0` (channel opacity 1, FILL sane, producers healthy per INFO 3). Opacity is sticky layer-mixer state → survives producer swaps; Caspar restart resets it but the next merge take re-blanks. Service log for those takes: `merge=true shouldRunBankCrossfade=null fadeDur=25 currentMapSize=0`.

## 2. Root cause

With a merge/+Animate transition the incoming layer is staged at the ACTIVE bank (same physical layer as on-air; scene-take-lbg-jobs.js ~147). When `currentMap` is EMPTY (post-Caspar-restart, cleared live state), the exit/orphan-fade logic cannot see that physical layer 10 belongs to the incoming look — it classifies it as an on-air orphan and emits `MIXER <ch>-<L> OPACITY 0 <fade>` AFTER the PLAY. The take blanks itself.

## 3. Tasks (haiku-sized)

- [x] T217.1 **Guard the fade/exit set with the incoming physical layers:** in the pgm-only/merge take path (grep `OPACITY 0` emission in src/engine/scene-take-pgm-only.js, src/engine/scene-exit-layers.js and the merge branch of scene-take-lbg.js), compute `incomingPhys = new Set(takeJobs.map(j => j.pLayer))` and EXCLUDE those layers from every fade-out/opacity-0/STOP/CLEAR set built by the same take. This must hold for ALL currentMap states (empty map is the trigger, but the guard is unconditional).
- [x] T217.2 **Reset opacity on (re)use:** every PLAY/LOADBG job the take pipeline emits for an incoming layer must be preceded (or followed pre-COMMIT) by `MIXER <ch>-<L> OPACITY <layer.opacity ?? 1>` so a stale 0 from any past bug can never hide fresh content (defensive; cheap — the mixer lines for the layer already exist, verify opacity is ALWAYS included, not only when != 1: scene-take-lbg-jobs.js ~248 `if (vol !== 1)`-style conditional emission is the suspect pattern — check the OPACITY equivalent).
- [x] T217.3 Smoke `tools/smoke/smoke-wo217-self-blank-guard.test.js`: merge take on a pgm-only channel with EMPTY currentScene → captured lines contain PLAY at layer L and NO `OPACITY 0` targeting L; non-merge bank take unaffected; stale-opacity reset line present for incoming layers. Mock style per smoke-wo209.
- [x] T217.4 node --check/eslint/gate; add to run-offline-tests FILES.

## 4. Acceptance criteria

- [ ] A217.1 Post-Caspar-restart takes on the PGM-only screen always show content (owner check).
- [ ] A217.2 Merge transitions still fade out genuinely-exiting layers; gates green.

## 5. Work log

- 2026-07-14 — WO created during live outage; immediate relief `MIXER 3-10 OPACITY 1` applied (screen restored); root cause pinned to exit-fade classifying the incoming same-bank layer as an orphan when currentMap is empty.
- 2026-07-14 T217.1-T217.4 COMPLETE: 
  - **T217.1 guard fix** (src/engine/scene-take-lbg-merge.js:27-51, :88-96): Added physical layer exclusion guard in `buildMergeOutgoingOpacityDeferLines()` — compute `incomingPhys = new Set(takeJobs.map(j => j.pLayer))` and exclude from fade-out; also pass `activeBank` and `phys` to function to compute physical layers correctly for merge transitions on any bank.
  - **T217.2 defensive opacity reset** (src/engine/scene-take-lbg-jobs.js:232-235): Changed OPACITY emission from conditional (`layer.opacity != null && layer.opacity !== 1`) to unconditional (`layer.opacity ?? 1`); ensures stale opacity-0 from prior bugs never blocks fresh content.
  - **T217.3 smoke tests** (tools/smoke/smoke-wo217-self-blank-guard.test.js): Three tests covering (a) merge take with empty currentScene does NOT fade incoming layer, (b) genuinely exiting layers still emit fade-out, (c) incoming layers always get OPACITY reset line. All pass.
  - **T217.4 verification**: node --check ✓, eslint --quiet ✓, WO-217 tests ✓ (3/3), WO-209 tests ✓ (4/4), WO-160b tests ✓ (8/8), WO-211 tests ✓ (9/9), full offline suite ✓ (185 pass / 2 skip / 0 fail). Added to run-offline-tests.js FILES.
