# WO-901 — Lockscreen: hidden mouse pointer + "Bounce" style (one bouncing character)

**Area:** godot-client
**Status: DONE (31.10, Xvfb :98 probe with pointer calibration + 25152-test runner + --check boot; owner QA on the real screens outstanding)**
**Source:** owner 31.10: *"lockscreen still has an active mouse pointer. id also like the lockscreen to have an option to work
similar to bouncing character test patern. here just one, character, the eyes changing on bounce, size and speed in settings."*
**Related:** WO-838 (lockscreen), WO-411 (bouncing-character test pattern), WO-891 (second operator window)

## 1. Investigation

- **Pointer.** The lock (`app/lock_overlay.gd`, WO-838) only swallows input events in `_input` and draws a translucent
  `CanvasLayer`. Nothing ever touched `Input.mouse_mode`, so the OS cursor stayed an arrow (the overlay root even set
  `mouse_default_cursor_shape = CURSOR_ARROW`, `lock_overlay.gd:42`). No `Input.set_custom_mouse_cursor` / `MOUSE_MODE_*` use
  anywhere in `godot/client` (`rg MOUSE_MODE` is empty), so there is no prior mode to fight with and no per-Control cursor
  override that would beat a global hide. WO-568's "operator monitor never auto-hides the cursor" is a client policy
  (nothing hides it); this change hides it only while locked.
- **Second window** (`app/second_window.gd`, force_native). `Input.mouse_mode = HIDDEN` is application-wide, and Godot's X11
  backend blanks the cursor on every native window it owns, so the second window needs no code of its own. Proven below,
  not assumed.
- **The test pattern is not Godot code.** The bouncing character is the LED test card HTML template
  (`template/led_grid_test-render.js`, WO-411/588): six frames (`ch_{both_open,left_closed,right_closed}_green.svg` and the
  red-eyed `both_open/left_closed/right_closed.svg`), box = 26 % of the shorter side, speed = box px/s per axis (x 0.8..1.2),
  collision on the DRAWN glyph rect, dt capped 0.1 s, a random frame on every wall hit. There is no Godot drawing code to
  call, so the Godot side reuses the same art (shrunk copies) and mirrors the same motion rules in a pure model.
- Lock prefs live in `ui.cfg [lockscreen]` (`core/lock_model.gd`, WO-838), edited by `features/settings/lockscreen_pane.gd`.

## 2. What was done

- `app/lock_overlay.gd`: on `lock()` remember `Input.mouse_mode` and set `MOUSE_MODE_HIDDEN`; `unlock()` restores exactly the
  remembered mode. While locked `_process` re-asserts HIDDEN if anything changed it (cheap compare). Bounce child
  (`BounceCharacter`) added under the text; `reload()` shows it instead of the logo when `style == "bounce"` and passes size /
  speed. The logo and the "Logo" pref are ignored in Bounce style (the character is the picture); the text stays.
- `core/bounce_model.gd` (new, pure): clamps, `box_px` (pct of the shorter side, min 40), aspect `fit`, `start`, `step`
  (wall bounce on the drawn rect, 0.1 s dt cap, an axis the glyph does not fit on never flickers), `next_frame` (always a
  DIFFERENT eye frame than the current one, so every bounce visibly changes the eyes).
- `app/bounce_character.gd` (new Control): loads the six frames once (mipmapped), `_process` only while visible in the tree,
  one `draw_texture_rect` per frame, no shader. New random start on every lock; size/speed changes rescale in flight.
- `assets/ui/bounce/*.png` (new): the test pattern's six frames (`green_open/left/right`, `red_open/left/right`), ffmpeg
  Lanczos from `template/ch_*_green.png` and `both_open|left_closed|right_closed.png`, 420 px wide, ~160 KB each. Loaded at
  runtime from the raw file (no import step), like `assets/ui/*.png`.
- `core/lock_model.gd`: prefs `style` ("plain" default | "bounce"), `bounce_size` (10..60 % of the shorter screen side,
  default 26 like the test pattern), `bounce_speed` (0.1..3.0 box heights per second, default 1.0 = the test pattern's);
  every value validated / clamped on load.
- `features/settings/lockscreen_pane.gd`: Style dropdown, size and speed sliders with value labels (dimmed in the plain
  style; sliders, so RULES.md number-field maths does not apply), note about the pointer.
- Second window while locked: **keeps its plain translucent cover** (WO-891 `set_locked`), no mirrored character: the owner
  asked for ONE character, and a second animation there would be a second character.
- `app/lockscreen.gd`: dev flag `--probe-lock=plain|bounce` (stores the style in ui.cfg, locks 4 s after boot; only run it
  with its own `XDG_DATA_HOME`).
- `tests/test_bounce_model.gd` (new, picked up by the runner).

## 3. VERIFIED

- Godot runner: `run-client.sh --test` -> `[tests] 25152 passed, 0 failed` (includes 10 new bounce tests: clamps, box/fit,
  start, free flight, all four walls + corner on the drawn rect, stall/negative dt/wider-than-screen, a 3000-step run that never
  leaves the screen and bounces, `next_frame` never repeats and reaches all 5 others, the six PNGs decode, prefs round trip
  with invalid values). `run-client.sh --check` -> boot OK, no script errors.
- Probe client on private Xvfb :98 (own `XDG_DATA_HOME` copy of the owner's userdata, `--demo`, second window seeded as a plain
  window with the Audio tab at 1100,150), `ffmpeg x11grab -draw_mouse 1`, screenshots in
  `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo901/`:
  - `locked_1.png`, `locked_2.png`, `locked_3.png`: locked in Bounce style, the pointer moved with `xdotool` before each
    shot: no pointer; the character moved between shots and its eyes differ (red left-closed / green open).
  - `locked_over_second.png`: pointer parked over the second (native) window while locked: no pointer.
  - **Calibration:** after unlocking, the same capture shows the arrow over the second window
    (`crop_sec.png`) and over the main window (`crop_main.png`), so the capture does draw pointers and the locked shots are
    truly pointer-free; unlocking restores the pointer on both windows.
  - `locked_big.png`: size 47 %, speed 0.30 set from the Settings sliders (ui.cfg got `bounce_size=47`,
    `bounce_speed=...`), pointer parked inside the character: none. `pane.png`: the Settings -> Lockscreen pane.
- The probe client and Xvfb were stopped by PID (cmdline checked); the owner's ui.cfg / godot were never touched.
- Not verified: owner's real dual-monitor NX session (real WM, real second monitor); a window created WHILE locked (none are:
  the dock bubble / second window exist before the lock); a previs RMB-capture mode being active at lock time (restored on
  unlock by design, not exercised); character path behind a native second window overlapping the main window only happens on
  a single-screen dev setup.
- Process note: edits to `lock_model.gd`, `lock_overlay.gd`, `lockscreen_pane.gd` and `lockscreen.gd` were applied with a small
  scripted exact-string replace (each anchor asserted to occur once), not the Edit tool. WO INDEX not rebuilt (told not to touch it): run
  `node tools/wo/build-index.js` before CI.
