# Work order: Fix A/B bank transitions by layer stacking order

## Goal
Fix look-to-look transitions in the A/B bank workflow so they never:
1. Dip to ~50% opacity mid-transition (both incoming and outgoing are semi-transparent).
2. Look like a “cut” in the reverse-direction case.

The transition behavior must be correct **in both directions**, based on which physical layer is on top:
- When the incoming layer is above the outgoing layer: fade the incoming in.
- When the incoming layer is below the outgoing layer: fade the outgoing out, and make the incoming visible immediately.

## Background / current problem
- HighAsCG uses a dual-bank physical mapping for a logical layer `N`:
  - bank A: physical `N`
  - bank B: physical `N + 100` (e.g. logical `10` → physical `10` and `110`)
- The physical layer ordering determines which one covers the other.

Observed behavior on some transitions:
- During the crossfade, both incoming and outgoing banks have semi-transparent opacity, producing a visible ~50% dip.
- In the reverse order, the expected fade might not occur (perceptually looks like a cut).

## Desired command semantics (what must happen)
Assume screen currently shows **example1** on physical layers `1-10` (on-air), and incoming **example2** targets `1-110` (inactive).

### Case 1: Incoming is on top (110 covers 10)
Screen: `1-10`  
Incoming: `1-110`

Required behavior:
1. Prepare incoming bank `1-110` (LOADBG, FILL, etc.) off-air.
2. `PLAY` incoming bank `1-110`.
3. Fade incoming opacity from 0 → 1 over `$transition`.
4. Wait `$transition`.
5. `STOP` + `MIXER CLEAR` outgoing bank `1-10`.

### Case 2: Outgoing is on top (110 covers 10)
Screen: `1-110`  
Incoming: `1-10`

Required behavior:
1. Prepare incoming bank `1-10`.
2. `PLAY` incoming bank `1-10` with **0 duration** (i.e. it becomes immediately available underneath).
3. Fade outgoing opacity from 1 → 0 over `$transition` (making the incoming reveal).
4. Wait `$transition`.
5. `STOP` + `MIXER CLEAR` outgoing bank `1-110`.

### Why this fixes the 50% dip
Because only the top layer should be semi-transparent during the fade. The bottom layer must stay fully opaque to maintain full composite brightness.

## Scope
### A) Code paths to update
1. `src/engine/scene-take-lbg-jobs.js`
   - compute a per-take/per-layer flag:
     - `incomingIsAboveOutgoing`
   - adjust:
     - whether incoming needs the pre-hide `MIXER ch-layer OPACITY 0 0` before `FILL/PLAY`
     - what opacity lines get generated in `mixerLines` and `prePlayOpacityZeroLine`
2. `src/engine/scene-take-lbg-amcp-pipeline.js`
   - update crossfade opacity generation:
     - fade incoming only OR fade outgoing only depending on `incomingIsAboveOutgoing`
   - ensure command order stays correct:
     - prepare → commit → play → opacity tween → commit → teardown after fade window
3. Ensure teardown in `src/engine/scene-take-lbg-teardown.js` clears the correct outgoing physical bank after `fadeMs`.

### B) Docs to update
- Update the “bank crossfade” sections in:
  - `docs/reference/amcp-clean-look-fade.md`
  - `docs/reference/amcp-pgm-look-take-pipeline.md`
  - `work/amcp-revision.md`

## Implementation tasks (engine changes)
### 1) Determine incoming vs outgoing stacking direction
For bank A/B mapping:
- bank B physical is always `+100` → it sits “above” bank A for the same logical layer.

Therefore, `incomingIsAboveOutgoing` is determined by whether the incoming bank is `b` and the outgoing bank is `a` (or generally by comparing physical layer numbers `pIn` vs `pOut`).

### 2) Adjust `incomingStartsHidden` logic
Current behavior uses `incomingStartsHidden = shouldRunBankCrossfade` (or similar), which hides incoming even when it must be visible underneath.

New rule:
- If incoming is above outgoing:
  - hide incoming with `OPACITY 0 0` before `FILL/PLAY` so geometry is not visible on program.
- If incoming is below outgoing:
  - do **not** pre-hide (or set to 1 immediately after `PLAY` with 0 duration), so once outgoing begins fading out the incoming is already at full opacity.

### 3) Update crossfade opacity generation
In the bank crossfade branch:
- If `incomingIsAboveOutgoing`:
  - emit only: `MIXER incoming OPACITY 1 <fadeDur> <tween>`
  - do not emit a paired outgoing fade line during the window
  - clear outgoing in teardown after fade window
- Else (incoming below outgoing):
  - emit only: `MIXER outgoing OPACITY 0 <fadeDur> <tween>`
  - emit incoming “instant visible” setup (opacity to 1 with 0 duration)
  - clear outgoing in teardown after fade window

### 4) Update `PLAY` behavior
Ensure the `PLAY` command matches the case:
- Incoming-above: play incoming normally (and fade in opacity).
- Incoming-below: play incoming with **no opacity fade** on incoming side; outgoing fade drives the reveal.

## Acceptance criteria / verification
1. Run two controlled transitions:
   - Direction A: screen `1-10` → incoming `1-110`
     - mid-transition log must show:
       - incoming `OPACITY ~0.5` over `<transition>`
       - outgoing stays at full opacity (no `OPACITY 0 <transition>` during window)
   - Direction B: screen `1-110` → incoming `1-10`
     - mid-transition log must show:
       - outgoing `OPACITY ~0.5` over `<transition>`
       - incoming becomes/starts at full opacity (no `incoming OPACITY 0 <transition>`)
2. Compare Caspar video frames:
   - no moment where composite drops to ~50%
   - no “cut” look in the reverse-direction case
3. Confirm teardown:
   - only outgoing bank is `STOP/CLEAR` after fadeMs
   - incoming bank remains until next take and is not cleared early

## Work log

### 2026-05-27 — Agent (implementation)

**Code:** `scene-take-lbg-jobs.js` — `incomingIsAboveOutgoing` when inactive bank is B; pre-hide only for top incoming; `prePlayOpacityFullLine` for bottom incoming. `scene-take-lbg-amcp-pipeline.js` — crossfade emits incoming fade **or** outgoing fade (not both). Docs updated in `amcp-clean-look-fade.md`, `amcp-pgm-look-take-pipeline.md`, `amcp-revision.md`.

**Not validated:** live AMCP capture / frame check on playout rig — run two-direction take and grep logs for single-sided `OPACITY <dur>` tweens.

## Instructions for next agent
1. Implement direction-aware fade generation first (incoming-above vs incoming-below).
2. Validate with a live capture:
   - extract AMCP from `logs.md`
   - confirm only one side (incoming or outgoing) receives the duration tween lines.
3. Update the docs’ crossfade examples to match the final behavior.

