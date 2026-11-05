# WO-966 — The media file Inspector gets "Set in" / "Set out" buttons at the preview position

**Area:** godot-client
**Status: DONE (05.11.26 — unit 6 checks, Godot suite 25988/0, GUI e2e 22 2/2 in the sandbox; owner QA with a live preview)**

Owner 05.11: *"in the media clip's inspector there is no buttons to set in/out points, only input boxs"*

Related: [WO-962](./962_WO_trim_section_clip_transport.md) (transport in the layer Inspector's trim section).

## 1. Investigation

- The media file page is `features/live/media_inspector.gd`. Its trim row was only two time `LineEdit`s
  (`_time_field` for `trimInMs` / `trimOutMs`) and a "✕" clear button. The values save through `_save(patch)` →
  POST `/api/media/library/defaults`, which holds the file's defaults that a look layer copies on add.
- The page already runs a preview on the operator's Caspar preview (`preview`, with `preview.pos` in seconds,
  `preview.active()`, and `position_changed`). A waveform click seeks it. So "where the playhead is" is already
  known on that page, but nothing on the page could write it into In or Out. The operator had to read the time
  and type it in.
- Without an operator screen the preview is unavailable ("Preview unavailable: No operator screen configured"). In
  that case there is no position to take.

## 2. What was done

- `media_inspector.gd`:
  - `_mark_button(row, key)` adds a "Set in" button after the In box and a "Set out" button after the Out box.
  - A press saves `{trimInMs | trimOutMs: preview.pos × 1000}` through the existing `_save`. The boxes then refresh
    from the stored defaults, the same way as after typing.
- `static mark_patch(key, pos_s, defaults)` builds the patch. It refuses a point that would cross the other one,
  e.g. "In must be before Out — move the preview before the out point". The message shows on the page's message
  line, and nothing is saved.
- `_sync_marks()` disables both buttons while there is no running preview or the file is not in the library. The
  tooltip then adds "(start the preview first)". It runs on `_sync` and on every `position_changed`.

The buttons only change the stored values, so the boxes stay the place to type exact times.

## 3. Verified

- Unit test `tests/test_wo966_media_marks.gd`: 6 checks covering rounding, negative clamping, In/Out crossing in both
  directions, and no other point set. Godot suite 25988 passed, 0 failed; `run-client.sh --check` boot OK.
- GUI e2e `22_wo966_media_set_in_out` (sandbox, hidden Xvfb): 2/2.
  - Selecting `e2e_bars.mp4` shows "Set in" after In and "Set out" after Out.
  - Both are disabled because the sandbox has no operator screen, so there is no preview. The screenshot shows them
    greyed beside the boxes.

Owner QA: on the box, play a clip's preview in its media Inspector, pause or click the waveform, then press
Set in / Set out.
