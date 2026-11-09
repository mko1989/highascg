# WO-1008 — Previs: full screen view with a floating, hideable Inspector; middle-drag pans the camera
**Area:** godot-client
**Status: DONE (09.11 — Godot suite 26161/0 incl. test_view_focus.gd, boot check, live on the owner's client with the pointer: full screen, Hide / Inspector, float drag, Esc, middle-drag pan)**

Owner, 09.11:
- "make the previs possible to fullscreen the view with only inspector from the main gui but floating with and
  option to hide it."
- "also holding midle mouse button should enter camera move, left rigth up down."

## Investigation

- **Layout.** `app/shell.gd` builds a header row over an `HSplitContainer`. The split holds Sources | (tabs | Inspector).
  - The Inspector is a single shared column (`InspectorPanel.current`, WO-608 R2). Previs puts its whole page there
    (`_side`, WO-640), so a full-screen view needs *that* column; it cannot open a copy.
  - The Previs tab's view area is `stack` in `previs_tab.gd` `_ready`. It is a plain `Control` that already holds
    free-placed overlays (coverage note, auto overlay, tracking view), so a float can be positioned by hand inside it.
  - `previs_tab.gd` sat at exactly 500 lines, so the feature goes in its own file.
- **Camera.** `previs_stage.gd` `handle_input` used the left button to orbit (`_yaw` / `_pitch` around `_target`) and
  the wheel to zoom. The middle button did nothing.
  - `aim_drag` (right button) and `move_drag` (left button on the selection) run before it in `_on_3d_input`, and
    neither uses the middle button.

## What was done

- **`app/view_focus.gd`** (new, generic, works for any page). The page's toolbar gets a "Full screen" toggle; F11
  also toggles it while the page shows.
  - **Entering full screen:**
    - hides the shell's header and Sources column (`ViewFocus.chrome`, set by `shell.gd`) and the page's tab strip;
    - lifts the Inspector out of its split into a floating panel over the view, without its footer (Playlists /
      Timers / audio; new `InspectorPanel.set_footer_shown`). "Only inspector" was the request.
  - **The float:** spans the view's height, starts against the right edge, and its title bar drags it sideways.
  - **Hide** leaves a small "Inspector" button in the top-right corner that brings it back.
  - **Leaving:** the button, F11, or Esc (only when nothing else took the key) puts the Inspector back at its old
    index in the split and shows the chrome again. It also leaves on its own if the page stops being visible.
  - A page on the second operator window (WO-891) only hides that window's strip; the main window's chrome is
    checked by window.
  - Dev flag `--probe-fullscreen[=hidden]` starts that way, for screenshot checks.
- **`previs_tab.gd`:** one line wires it into the toolbar. The Fit button now uses the new `previs_ui.gd` `button()`
  helper, to stay at 500 lines.
- **`previs_stage.gd` `pan()`:** while the middle button is held, the orbit point slides in the camera's screen plane
  (camera basis x / y). The rate is `2·dist·tan(fov/2) / viewport height` per pixel, so the stage follows the mouse
  one-for-one at the orbit point. Orbit, zoom, Fit and the presets are unchanged.

## What was verified

- **Godot suite:** 26161 / 0, including `tests/test_view_focus.gd`.
  - Full screen hides the header, Sources and the strip.
  - The Inspector floats over the view, footer hidden, against the right edge and the view's height.
  - Hide → corner button → back.
  - Off → the Inspector is back at index 1 in its split, footer shown, chrome back.
  - Middle drag: 100 px right moves the target −x by exactly 100 px of picture at the orbit point; down moves it up;
    no orbit; it stops when the button is released.
- **Checks:** `run-client.sh --check` boots clean; `check-max-file-lines` passes.
- **Live, on the owner's client** (pointer use OK'd by the owner, then relaunched normally on Previs):
  - with `--probe-fullscreen`: header, Sources and tabs gone; the floating Inspector shows the Previs page;
  - middle-drag 300 px right and 100 px down moved the stage with the mouse;
  - Hide → corner "Inspector" → back;
  - the float dragged 750 px left;
  - Esc → normal layout, Inspector back in its column with the footer.
