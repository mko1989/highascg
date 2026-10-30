# Card 02 — Timeline: one clip, play, pause, play to the end, end holds the last frame (WO-834)

**Area:** Timeline  **Takes PGM:** no (the timeline plays to the PRV bus only — the **PRV** box stays ticked, **PGM** stays unticked)  **Needs:** media `e2e_bars.mp4` (4 s) in Sources → Media (provisioned by the coordinator with `node tools/test-agent/provision-fixtures.js`; always present in the sandbox), one PGM/PRV screen  **Time:** ~4 min

## Preconditions
1. `tools/test-agent/caspar channels` → `preview` and `program` are non-empty. Write down the first numbers: **PRV** (sandbox: 2) and **PGM** (sandbox: 1).
   - SANDBOX ONLY (a fresh sandbox has no screen, so both lists are empty): `tools/test-agent/ui tab Devices`, `tools/test-agent/ui click "Add destination"`, then run `caspar channels` again.
   - On the live box empty lists mean no screen: UNCLEAR.
2. `tools/test-agent/ui tab Timeline` → ok:true, and `tools/test-agent/ui list buttons` has a line `[button] "＋" tip="New timeline"`.
3. `tools/test-agent/caspar info <PRV>` → `"playing":[]` and `tools/test-agent/caspar info <PGM>` → `"playing":[]`. Else UNCLEAR (say what plays).
4. `tools/test-agent/ui list rows` shows `"e2e_bars.mp4"`; note its `at` as (SX, SY).
5. `tools/test-agent/caspar api /api/timelines` → count the entries of `result`; remember it as **TL_BEFORE**.

## Steps

### 1. New timeline
- Run: `tools/test-agent/ui click "New timeline"`, `tools/test-agent/ui wait 1`, `tools/test-agent/ui shot 01_new_timeline`, `tools/test-agent/caspar api /api/timelines`
- Expected: `ok:true`; the API list has TL_BEFORE + 1 entries; take the **last** entry's `id` as **TL**. The shot shows three empty lanes named `Layer 1`, `Layer 2`, `Layer 3` under a ruler, and `ui list fields` shows total duration `00:00:30:00`.
- Evidence: shot `01_new_timeline`, TL.

### 2. Give it a recognisable name
- Run: `tools/test-agent/ui click "Rename timeline"`, `tools/test-agent/ui key ctrl+a`, `tools/test-agent/ui type "ZZ release-test"`, `tools/test-agent/ui key Return`, `tools/test-agent/ui wait 1`, `tools/test-agent/caspar api /api/timelines`
- Expected: the entry with id TL has `"name":"ZZ release-test"`; `ui list options` has a line starting `[option] "ZZ release-test`.
- Evidence: none.

### 3. Drag the clip onto Layer 1
- Run: `tools/test-agent/ui shot 02_lanes`; Read it. Choose a point **on the Layer 1 lane, just right of the playhead (the red vertical line at the lane's left end)**, about 20 px right of the playhead and vertically in the middle of the Layer 1 row → (DX, DY). Run `tools/test-agent/ui drag_xy SX SY DX DY`, `tools/test-agent/ui wait 1`, `tools/test-agent/ui shot 03_clip`, `tools/test-agent/caspar api /api/timelines/TL` (TL from step 1).
- Expected: `ok:true`; the shot shows a clip block labelled `e2e_bars.mp4` on the Layer 1 lane; the API timeline has `layers[0].clips` with one clip whose `source.value` is `e2e_bars.mp4`, `duration` 4000.
- Evidence: shot `03_clip`.

### 4. Trim the timeline to the clip
- Run: `tools/test-agent/ui click "Trim duration to last clip"`, `tools/test-agent/ui list fields`
- Expected: `ok:true`; the field `"/" tip="Total duration"` has a value between `00:00:04:00` and `00:00:05:00`.
- Evidence: the value.

### 5. Play, then pause about a second later
- Run as ONE shell command, exactly like this (the timeline is only about 4.5 s long; separate commands are too slow and it would reach its end before the pause): `tools/test-agent/ui click "Play / pause from the playhead (Space)" && tools/test-agent/ui wait 1 && tools/test-agent/caspar api /api/timelines/TL/state && tools/test-agent/ui click "Play / pause from the playhead (Space)"`. Then `tools/test-agent/ui shot 04_paused`.
- Expected: every part answers `ok:true`; the first click's `label` is `"▶"` and the second click's `label` is `"❚❚"`; the state printed between the two clicks has `"playing":true` and `position` between 300 and 3000.
- Evidence: shot `04_paused`, the state JSON.

### 6. It is paused
- Run: `tools/test-agent/ui wait 1`, `tools/test-agent/caspar api /api/timelines/TL/state`, `tools/test-agent/caspar info <PRV>`
- Expected: state `"playing":false` (no `endHeld`, or `"endHeld":false`); `caspar info <PRV>` `playing` has one entry containing `e2e_bars` with `(paused)`; note `position` as **P1** (it must be > 300 and < 3500).
- Evidence: the state JSON, the info JSON.

### 7. Play on to the end: the last frame is held (WO-834)
- Run: `tools/test-agent/ui click "Play / pause from the playhead (Space)"`, `tools/test-agent/ui wait 5`, `tools/test-agent/caspar api /api/timelines/TL/state`, `tools/test-agent/caspar info <PRV>`, `tools/test-agent/ui shot 05_end`
- Expected: state `"playing":false` and `"endHeld":true`; `position` is within 80 ms below the timeline duration (duration = the `duration` of the timeline in `caspar api /api/timelines/TL`, about 4560) and larger than P1; `caspar info <PRV>` still lists the clip `e2e_bars`, `(paused)` — the picture was NOT cleared to black.
- Evidence: shot `05_end`, the state JSON, the info JSON.

### 8. Play again after the hold: starts over from the beginning
- Run as ONE shell command: `tools/test-agent/ui click "Play / pause from the playhead (Space)" && tools/test-agent/ui wait 1.5 && tools/test-agent/caspar api /api/timelines/TL/state`, then `tools/test-agent/ui shot 06_restart`
- Expected: state `"playing":true`, no `endHeld`, and `position` below 2500 (it restarted from 0 — it did not resume at the end).
- Evidence: shot `06_restart`, the state JSON.

### 9. Stop
- Run: `tools/test-agent/ui click "Stop (back to start)"`, `tools/test-agent/ui wait 2`, `tools/test-agent/caspar api /api/timelines/TL/state`, `tools/test-agent/caspar info <PRV>`
- Expected: `"playing":false`, `position` 0; `caspar info <PRV>` `playing` is `[]`.
- Evidence: the state JSON.

## Cleanup
Always.
1. If a dialog or menu is open (`tools/test-agent/ui state` lists it): `tools/test-agent/ui key Escape`.
2. If the timeline still plays: `tools/test-agent/ui click "Stop (back to start)"`.
3. `tools/test-agent/caspar info <PRV>` and `<PGM>` → both `"playing":[]` (if not, say so in NOTES).
4. The GUI has no delete-timeline button. The timeline `ZZ release-test` (id TL) is left in the project: write its id under NOTES as `LEFTOVER timeline TL "ZZ release-test"` — the coordinator removes it.

## PASS rule
Steps 1–9 all PASS, Cleanup done.

## FAIL / UNCLEAR rule
- **FAIL**: a command worked but its Expected is not met (e.g. step 5 the second click's label is `"▶"` — the timeline had already ended —, step 7 clip disappeared or `endHeld` is missing; step 8 position stays at the end, i.e. Play after the hold does not restart) → expected vs seen + shot, skip the rest, do Cleanup.
- **UNCLEAR**: a label is missing/disabled/covered, `ok:false`, or you cannot find the Layer 1 lane in the shot → README section 4.
- Never improvise coordinates or labels beyond the rules written in steps 3.
