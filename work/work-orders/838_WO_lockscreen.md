# WO-838 — Lockscreen (Settings)

**Status: DONE (30.10, Xvfb GUI run + Godot unit tests + --check boot; owner QA on the real screen outstanding)**
**Source:** owner 30.10: *"add setup in settings, lockscreen. it should display locked (by default), logo (changable) and a
semi transparent bg (changeable), lock any input other than the set key combination (default shift+ctrl+L both for lock
and unlock-changable of course)"*.

Spec:

- Settings has a Lockscreen section: text (default "LOCKED"), logo (changeable; default the HighAsCG logo),
  background colour and opacity (semi-transparent by default), key combination (default Ctrl+Shift+L).
- The same combination locks and unlocks.
- While locked, every other input (keys, mouse, wheel, touch) is swallowed by the client.

## 1. Investigation

- **Settings** (godot/client/features/settings/settings_tab.gd): a `TabContainer` of panes; server-backed panes use
  `settings_form.gd` rows bound to the `Settings` mirror (autosave 600 ms to the node), hand-built panes
  (`SystemPane`, `LiveAudioPane`, …) are VBoxContainers built with `pane_kit.gd`, mounted via
  `_pane("Title").add_child(XPane.new())`. Per-machine client prefs (UI scale, perf overlay, demo switch) are NOT in the
  Settings mirror: they live in `user://ui.cfg` sections (`window_placement.gd` `saved_scale`/`apply_scale`,
  `perf_overlay.gd`). A lockscreen is per machine (the operator's client), so it follows the ui.cfg pattern, as the
  coordinator's brief said. ui.cfg is shared by many keys: `LockModel.save_pref` re-loads right before each write.
- **Logo**: `res://assets/ui/logo.png` (72x96); the header (`shell.gd:158`, `sized_logo`) resamples it with Lanczos to
  the pixels it covers because plain bilinear breaks the thin outline into dots. The overlay does the same
  (`LockModel.fit_texture`).
- **Global input**: root `Window` is the only viewport (embed_subwindows true: dialogs/popups are embedded `Window`s).
  Existing handlers: `shell.gd:138 _shortcut_input` (F3), `project_undo.gd` `_input` + `_unhandled_key_input`,
  `timeline_tab.gd`, `devices_tab.gd`, `rear_panel.gd` `_input`, `previs_tab.gd` `_unhandled_key_input`. Godot order:
  embedded sub-window gets the event first (when it has focus / is under the pointer), then every node's `_input` in
  REVERSE tree order, then GUI (focus nav, LineEdit), then `_shortcut_input`, `_unhandled_key_input`, `_unhandled_input`.
  So the gate must be an `_input` that is the LAST node in the tree (first called) and must deal with embedded windows.
- Polling consumers (`Input.is_key_pressed` in xr_walk / media_panel alt-drag) are not event driven and cannot be
  gated by swallowing events (previs fly-through while locked is a known gap; extra native OS windows like the dock
  bubble are separate viewports and are not covered).

## 2. What was done

- `core/lock_model.gd` (new): defaults, ui.cfg `[lockscreen]` load (validated per key) / `save_pref` (reload+write),
  chord parse / format / exact match (`Ctrl+Shift+L` canonical order), `capture_verdict` (modifier-only = wait, plain
  Escape = cancel, bare key = reject), logo import (copies png/jpg/svg to `user://lockscreen_logo.<ext>`, removes the old
  copy), image load/Lanczos fit. The locked state is never stored.
- `app/lock_overlay.gd` (new, CanvasLayer 128): full-rect STOP Control with background colour (default black 0.6 alpha),
  centred logo and text. `_input` swallows every InputEvent while locked except the chord; the chord (and its echoes)
  is always consumed so it never types into a focused field; it toggles lock/unlock. On lock: focus released, drag
  cancelled, embedded dialogs hidden (non-popup ones re-shown on unlock; a 0.25 s scan hides windows opened meanwhile),
  node moved last in the root. `_process` polls the chord (`Input.is_key_pressed`) so it also works when an embedded
  dialog had the keyboard focus (events never reach the root `_input` then). Capture mode (`begin_capture`) records the
  next chord without the app seeing keys.
- `app/lockscreen.gd` (new autoload `Lockscreen`, project.godot): attaches the overlay to the root after the main scene.
- `features/settings/lockscreen_pane.gd` (new) + 2 lines in `settings_tab.gd` (tab "Lockscreen"): enabled checkbox,
  text (select-all on focus per RULES.md), logo preview + Change... (FileDialog png/jpg/svg) / Reset, background
  `ColorPickerButton` with alpha + Reset, key combination label + Set... / Default, "Lock now".
- `tests/test_lock_model.gd` (new): defaults, chord parse/format, exact match, capture verdicts, ui.cfg round trip
  (other sections survive, invalid values fall back, nothing "locked" stored), logo import / fit / reset.
- Bug found while verifying and fixed: after Set... the still-held new chord was read by the poller as a fresh press
  and locked at once (`_poll_down` now set when a capture finishes).

## 3. Verified

- Godot unit runner (`godot --headless --path godot/client --script res://tests/run_tests.gd`, own XDG_DATA_HOME):
  23121 passed, 0 failed (includes test_lock_model.gd). `run-client.sh --check`: boot OK, no script errors.
- GUI run on an Xvfb display (:97, isolated XDG dirs, `--demo`), screenshots in
  /tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo838/ :
  02_pane.png (Settings -> Lockscreen pane), 03_locked.png (chord pressed with the Text field focused: overlay with logo
  and LOCKED), 04_locked_after_input.png (click on the Defaults tab, typing "abc", click on the checkbox, Tab/Enter
  while locked: nothing changed, nothing typed), 06_capture_reject.png (bare L rejected with a message),
  07_captured.png (Ctrl+Alt+K stored in ui.cfg - this shot shows the poller bug later fixed), 10_after_capture_no_lock.png
  (fixed: Set... then Ctrl+Shift+L records without locking), 12b_dialog_then_lock_held.png (file dialog open and
  focused, chord held: locked, dialog hidden), 13_unlocked_dialog_back.png (unlock: dialog restored),
  14/15 (custom logo imported to user://lockscreen_logo.png, shown on the lockscreen; ui.cfg [lockscreen] holds key and
  logo). Unlock by the chord confirmed (05, 08, 13).
- Known limits: very short synthetic taps (xdotool key, ~12 ms) are only seen by `_input`, the poll path needs the chord
  held across a frame (a human press is); previs fly-through polling and native OS windows are not gated.
- Owner QA outstanding: look/feel on the real screen, multi-touch, a real gamepad.
