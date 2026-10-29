# WO-799 — Audio tab: ALSA hardware mixer docked at the bottom

**Status: IN PROGRESS (29.10) — built and suite green; owner QA on the glass still open**

Owner, 29.10:
> in the audio tab of the main gui i need alsa mixer in the bottom. so current view gets cut in the middle horizontaly and top is casparcg bottom is alsa.

## Reading of the request

The Audio tab (Godot, `godot/client/features/audio/audio_tab.gd`) keeps the CasparCG mixer on top.
The owner wants the ALSA hardware mixer (card gain, the sound card's own controls) on the same tab,
in a bottom pane. Top = CasparCG mixer, bottom = ALSA mixer, split by a draggable divider so the
CasparCG strips are not cut off in a fixed position.

## Investigation (29.10, read-only)

- `features/audio/audio_tab.gd:47-68` — the tab body is `bays` (inputs in a `ScrollContainer`, masters
  strip on the right), then `foot` (status line + the "+" add button). No split container today.
- `features/settings/live_audio_pane.gd:61-62` — the ALSA panel is `AlsaMixer.new()` added under
  Settings → Live audio. `features/settings/alsa_mixer_panel.gd` (161 lines) is self-contained:
  `load_mixer(false)` (line 72 of the pane) fetches `/api/audio/alsa-mixer?card=N`, shows card + view
  pickers, a row per control, and a "Launch alsamixer" button.
- The panel is reusable as-is: the pane only calls `add_child` and `load_mixer`.

## Plan

1. In `audio_tab.gd`, wrap the CasparCG body (`bays`) and a new bottom pane in a `VSplitContainer`
   (or keep `foot` below the split). Top child = existing bays; bottom child = `AlsaMixer.new()` with a
   scroll so a long control list never pushes the top off screen.
2. Load the ALSA panel lazily on first show of the Audio tab; refresh with the existing `load_mixer(false)`.
3. Keep the Settings → Live audio copy as-is. Two views of one panel are fine; do not move it.
4. Store the divider position only in memory (per session) — no new settings key.

## Constraints

- 500-line file limit (CI): `audio_tab.gd` is 363 lines; keep the split logic in a small helper if needed.
- Godot tests: `godot/client/tests/test_audio_mixer.gd` must stay green; add a layout test that the tab
  has a vertical split with both panes and that the top pane's minimum height is respected.
- Do not change the ALSA POST contract (`alsa_mixer_model.gd` `body()`).

## Acceptance

- Audio tab shows CasparCG mixer (top) and ALSA mixer (bottom), divider draggable, both usable at 1920×1080
  and at 1280×720.
- Godot suite green (`0 fail`) and `node tools/ci/check-max-file-lines.js` green.
- Owner QA: open Audio tab in the running client; CasparCG strips fully visible; ALSA controls move a fader.

## Verified

- Built: `features/audio/audio_tab.gd` (371 lines) wires `Split.dock(bays, _alsa)`; new
  `features/audio/audio_tab_split.gd` (31 lines, VSplitContainer, both panes in ScrollContainers,
  min heights 240 / 160); ALSA panel loads once on first show.
- Godot suite (opus check, 29.10): `godot --headless --script res://tests/run_tests.gd` → `[tests] 21930 passed, 0 failed`
  (baseline 21917; +13 incl. new `tests/test_audio_tab_split.gd`). `check-max-file-lines.js`: 0 over 500.
- NOT verified: visual layout at 1920×1080 / 1280×720, divider drag, live ALSA fader, initial split
  position (no split_offset set — top may not start at 60%). Owner QA on the glass.
