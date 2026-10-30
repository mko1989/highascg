# WO-707 — Follow → Auto: heads follow the detected person with no marker set-up

**Area:** tracking-vr
**Status: DONE (23.10.26: smoke-wo707 6/6, offline suite 2893/1 — the known WO-308 failure only, Godot 21223/0, boot
check OK; owner QA with a person in front of cam_1 / cam_2)**

Owner, 23.10: *"how do i enable tracking to move the fixtures. there is follow none in the follow inspector, with no
other options, especialy for dev we need an auto. both focus are at the right place."*

## Investigation

- The Follow dropdown (`godot/client/features/previs/tracking/follow_section.gd:239-246`) lists "— none —" plus the
  **project's marker defs** (`driver.defs` ← `previs.tracking.markers`). This project has `markers: []`, so "none" is
  the only entry. A follow id that the project doesn't define shows as "Marker N (not in this project)".
- The follow engine aims a head at `marks.get(fx.follow)` (`src/fixtures/follow-engine.js:232`). With no hub marker the
  head reports `no marker` (`:237`) and doesn't move.
- A detected person reaches the hub only through `DetectPin` (`src/tracking/detect-pin.js`):
  - **assist**: nudges the operator's marker onto the nearest person.
  - **replace**: writes `pin_marker_id` from one tracked person.
  - Both modes need that marker to already exist in the hub (`detect-pin.js:191`: `if (!marker) return …`).
  - So the existing route has three steps: (1) Tracking → Markers → **Add marker**; (2) Detection → Person detection on,
    pin mode Replace (or Assist); (3) Follow → that marker.
- Config on this box: detection enabled on cam_1 + cam_2, `yolo26n.onnx`, `pin_marker_id` 1, `pin_mode` assist.
- Focus Profile 1 / 2 positions: the owner says both are right. The WO-700 question about Profile 2 is closed, and it
  is left unchanged.

## What was done

- **`src/tracking/auto-follow.js` (new).** A server-owned marker, `AUTO_MARKER_ID` = **64999** (just below the
  presenter range, `presenters.js` MARKER_BASE 65000). It is driven by its **own** `DetectPin` in replace mode, using
  the same pick rule (sticky by track, else nearest the last pick, else the largest person).
  - It exists only while person detection is enabled **and** some head has `follow == 64999`. Otherwise it is removed
    from the hub, and the pin state resets so the next use makes a fresh pick.
  - Until the pin has been on a person it stays out of the hub, so heads on Auto hold instead of swinging to the seed
    point (0, 0). After that, nobody in view holds the last position with status 0.
- **`src/tracking/register.js`:**
  - `pinTick()` steps it after the operator's pin (`:143-144`).
  - `withPins` merges its attachments under the operator pin's, so the operator's own pin wins a shared person
    (`:210`).
  - The operator's Assist / Replace on a project marker is untouched: it is a separate `DetectPin` with its own state.
- **Godot:**
  - `follow_model.gd`: `AUTO_MARKER := 64999`.
  - `follow_section.gd`: the dropdown always offers **"Auto — the tracked person"**, and the status line names it
    "Auto".
- **Why this approach:**
  - **Rejected: auto-create a project marker.** It would write project data and mix with the operator's own pin
    config.
  - **Rejected: bind heads straight to persons.** It would bypass the hub, so it would also lose its hold/stale logic
    and the PSN / OSC marker outputs.
  - **Chosen:** one more hub marker reuses the whole follow chain unchanged.

## Verified

- `tools/smoke/smoke-wo707-follow-auto.test.js`, **6/6**. It checks that:
  - there is no marker before anyone is seen;
  - the marker appears on the first world person and follows them;
  - nobody in view gives a hold with status 0;
  - with no head on Auto, or detection off, the marker is removed;
  - the operator's marker 1 and its pin are untouched;
  - the wiring is pinned in register.js, follow_model.gd and follow_section.gd.
- The smoke is registered in `tools/ci/run-offline-tests.js`.
- Offline suite: 2896 tests, 2893 pass / 1 fail (the known WO-308 pointer-confine test).
- Godot `run_tests.gd`: 21223 / 0. `run-client.sh --check`: boot OK.
- Gates: lint, prettier, max-file-lines (register.js 497), unwired-exports: no new orphans.
- **Owner QA:**
  1. Select a head → Follow → **Auto — the tracked person**.
  2. Make sure Detection → **Person detection** is on and the fixture output is enabled.
  3. Walk into view of cam_1 / cam_2: the head follows. Step out: it holds.
