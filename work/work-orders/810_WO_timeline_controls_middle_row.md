# WO-810 — Timeline tab: the controls sit between the timeline and the preview

**Area:** godot-client
**Status: DONE (29.10, live e2e on the box) (29.10) — implemented; Godot suite 22202/0, boot check OK, WO-787 / WO-789 smokes 6/6; the look
on the glass is unverified (owner QA) · live e2e 29.10: PASS on the glass**
**Source:** owner 29.10: *"in timeline tab move all the controls to the middle between the timeline and preview."*
**Related:** [WO-602](./602_WO_godot_port_timeline.md) slices 7 / 8 (the transport and Dest rows),
[WO-787](./787_WO_timeline_preview_and_smooth_scrub.md), [WO-789](./789_WO_timeline_uses_live_preview.md) (the
Timeline tab borrows the Live preview), [WO-790](./790_WO_timeline_scrub_paced_and_faster_seek.md).

## Investigation (29.10, Opus)

The tab root is `godot/client/features/timeline/timeline_tab.gd` (a `VBoxContainer`, made in `app/shell.gd:82`).
Its `_ready` (lines 48-105) builds, top to bottom:

1. **`transport`** (`timeline_transport.gd`, an `HBoxContainer`), added at `timeline_tab.gd:56`. Built in
   `timeline_transport.gd:29-70`: timeline picker, ✎ rename, ＋ new, |◀ to start, ▶ play / pause, ■ stop, ▶| to
   end, ⟲ loop, the current-time field, "/", the duration field, Trim, Flag, − Fit + zoom, Follow.
2. **`dest`** (`timeline_dest.gd`, an `HBoxContainer`), added at `timeline_tab.gd:57`. Built in
   `timeline_dest.gd:22-47`: "Dest:" screen picker, PRV / PGM checks, the transition row (`TransitionRow`), Take, and
   the status label (expand-fill, right-aligned, clipped).
3. **`split`** (`VSplitContainer`, `timeline_tab.gd:71-86`):
   - pane 1 (top): `preview_slot`, a black `PanelContainer` (min height 120, `timeline_tab.gd:73-76`) that hosts
     `LivePreview.current` while the tab shows (`_borrow_preview`, lines 109-111, WO-789);
   - pane 2 (bottom): `view`, the timeline canvas (`timeline_view.gd`, expand-fill, `timeline_tab.gd:59-70, 79`).
   - The divider is ui.cfg `[timeline] preview_h` (default 480), read and saved at `timeline_tab.gd:80-85`; the offset
     is the preview pane's height.
4. `_throttle` (a Timer, no UI).

So today the order is **controls (2 rows) → preview → timeline**: the controls are at the top of the tab, above the
preview, far from the timeline they drive. The preview's own buttons (2D / 3D, Fit, Lights, Times, Auto, the Auto
overlay) are overlaid inside the shared preview (`live_preview.gd:56-57`) and are not Timeline-tab controls; they stay.

Constraints found:
- `transport` and `dest` only reach the tab through `tab` (set before they enter the tree); `transport.refresh()`
  calls `tab.dest.refresh()`, so both must be in the tree before the tab's first `refresh()` (line 105). Their
  `_ready`s use no tab state, so building them inside the split is safe.
- Smokes pin source text in `timeline_tab.gd` (`smoke-wo789-timeline-live-preview.test.js`: `_borrow_preview` and
  `visibility_changed.connect(_borrow_preview)`) and in `timeline_transport.gd` (WO-787 seek pin); none pin the
  layout lines.
- A `VSplitContainer` takes two panes only, so a row "in the middle" goes inside one pane. In the top pane it would
  shrink the preview for the same stored `preview_h`; at the top of the bottom pane the preview size logic is
  untouched (the stored offset still equals the preview height).

## What was done (29.10)

- **New `godot/client/features/timeline/timeline_layout.gd`** (27 lines): `stack(preview_slot, controls, view)` builds
  the `VSplitContainer`: pane 1 = the preview slot (unchanged), pane 2 = a `VBoxContainer` "TimelinePane" holding an
  `HFlowContainer` "ControlsRow" (transport, then Dest) above the timeline canvas. The row wraps when the window is
  too narrow for both, which gives back today's two lines; Dest is expand-fill so its status text still reads at the
  right. No control's own size changed.
- **`timeline_tab.gd`**: `add_child(transport)` / `add_child(dest)` removed from the tab's top; the split is now
  `TimelineLayout.stack(preview_slot, [transport, dest], view)` (line 76). The divider read / save (`[timeline]
  preview_h`), the WO-789 borrow and every signal hookup are unchanged. Both controls still enter the tree before the
  first `refresh()`, so `transport.refresh()` → `tab.dest.refresh()` behaves as before.
- **Why the bottom pane:** a split holds two panes. Heading the timeline pane keeps the stored offset equal to the
  preview's height, so the preview size logic and the operator's saved divider are untouched. In the top pane the
  same `preview_h` would have shrunk the preview by the row's height. The layout is in its own file so a headless
  test can build it without the autoloads the tab needs.
- `live_preview.gd` untouched: its own overlay buttons (2D / 3D, Fit, Lights, Times, Auto) stay inside the preview.

## Verified (29.10)

- **Godot suite:** 22202 passed / 0 failed (baseline 22190 + 12 new assertions). New
  `godot/client/tests/test_timeline_layout.gd`: the split's pane 1 is the preview, pane 2 is [controls row, canvas],
  transport before Dest in an `HFlowContainer`; and a source check that the tab uses `TimelineLayout.stack` with no
  top-level `add_child(transport|dest)`.
- **Boot check:** `run-client.sh --check` → boot OK (no script errors).
- **Smokes:** `smoke-wo789-timeline-live-preview` + `smoke-wo787-timeline-preview-and-scrub` 6/6.
- **500-line gate:** 0 files over (timeline_tab.gd 335).
- **Not verified:** the look on the glass (no GUI launched, no pointer automation). Owner QA: open Timeline, the
  controls row sits between the preview and the timeline; narrow the window and it wraps to two lines; drag the
  divider and restart, the preview height is kept.

## Live e2e (29.10, on the glass — real Godot client on :0, real PGM/PRV)

**PASS.** The Timeline tab has its controls row between the timeline and the preview (q810_timeline.png).

Evidence: session scratchpad `live-e2e/` (screenshots were read before they went in here; `onair.log` has every click with its epoch).
