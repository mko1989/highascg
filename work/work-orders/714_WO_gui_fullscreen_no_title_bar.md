# WO-714 — Operator GUI opens fullscreen, without the title bar

**Status: DONE (23.10.26; Godot 21373/0, `run-client.sh --check` OK; box: a second client instance opened borderless,
1920×1080 at 0,0, frame extents 0 — the running operator client keeps its frame until its next launch/boot = owner QA)**

Owner, next.md 23.10: *"the gui should start in a fullscreen mode without the system top bar."*

## Investigation

- **What the "top bar" is.** The box session has no panel (Openbox only, `~/.config/openbox/autostart`). The bar is
  Openbox's window title bar on the Godot client. Live, the autostarted client (pid 3434):
  `_NET_WM_STATE = MAXIMIZED_VERT, MAXIMIZED_HORZ`, `_NET_FRAME_EXTENTS = 0, 0, 19, 0`, geometry 1920×1061 at 0,38 on
  the single 1920×1080 monitor (DP-5). That is a 19 px frame on top.
- **Why it is maximized with a frame.** Nothing in the client asks for it. `project.godot` opens a 1920×1080 window,
  which plus the frame is bigger than the screen, so Openbox maximizes it and keeps the decoration. There are no
  `<application>` rules in `~/.config/openbox/rc.xml`.
- **Fullscreen exists but is never used.** `godot/client/app/main.gd:469` switches to `MODE_EXCLUSIVE_FULLSCREEN` only
  on `--fullscreen`. The session autostart (`~/.config/openbox/autostart`, `scripts/setup/09-openbox-autostart.sh:149`)
  starts `run-client.sh --autostart` and nothing else.
- **The dock does not constrain the choice.** The dock window (WO-628) is override-redirect (`xwininfo`: "Override
  Redirect State: yes"), so it is above every managed window, fullscreen or not.
- **Other mode writers.** The dock's HighAsCG button restores a minimized main window to `MODE_MAXIMIZED`
  (`app/operator_dock.gd:141`). The start-up launcher (WO-645) minimizes the main window and then restores the mode it
  captured (`app/boot_question.gd:42-52`). The screen picker moves the main window with `current_screen`
  (`app/operator_screen_picker.gd:225`).
- `main.gd` is at 499 lines (CI limit 500), so the logic cannot go there.

## What was done

- `godot/client/app/window_placement.gd`: `window_mode(args, on_box)` (pure) + `apply_mode(w, args, on_box)`.
  - On the box: `borderless = true`, `MODE_MAXIMIZED` — the whole screen with no title bar.
  - `--fullscreen` keeps exclusive fullscreen, as before.
  - `--windowed` opts out on the box.
  - Off-box clients (WO-688 laptop windows, `Platform.is_local_origin` false) are unchanged and keep the frame.
- Why borderless + maximized over WM fullscreen: the window stays in Openbox's normal layer, so apps launched from the
  dock stack over it as usual. It also matches the dock's existing restore (`MODE_MAXIMIZED`) and the launcher's
  captured-mode restore, so neither of those had to change.
- `move_to_screen(w, i)`: un-maximize → move → maximize. A maximized window moved with `current_screen` keeps the old
  screen's size. Used by the screen picker.
- `main.gd`: the two `--fullscreen` lines are now one `Placement.apply_mode(…)` call (499 → 498 lines).
- `tests/test_window_placement.gd`: `test_window_mode_no_title_bar_on_the_box` (on box, off box, --windowed,
  --fullscreen, --fullscreen wins).

## What was VERIFIED

- Godot unit tests: 21373 passed, 0 failed. `run-client.sh --check`: boot OK. `check-max-file-lines`: 0 over.
- Box, second client instance (`run-client.sh --quit-after=30 --tab=1`; the operator's own client was left running):
  `_MOTIF_WM_HINTS = 0x2, 0x0…` (no decorations), `_NET_FRAME_EXTENTS = 0, 0, 0, 0`, geometry 1920×1080 at 0,0,
  `MAXIMIZED_VERT/HORZ`. It was also `HIDDEN` at that moment, because the server's boot question was pending with
  `launcher: true` (`GET /api/system/operator-screen`), so the WO-645 launcher showed and minimized it. That is the
  expected behaviour.

**Not verified / owner QA:**
- The running operator client (pid 3434) still has its frame; it picks up the change on its next launch or boot.
- Moving to another screen with the screen picker — the dev box has one monitor.
- The dock's HighAsCG button after a minimize: it should come back with no frame.
