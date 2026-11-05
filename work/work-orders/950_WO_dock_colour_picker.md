# WO-950 — Operator dock: a colour picker (click any colour on screen, copy it as HEX / Caspar / RGB / 0–1 / HSV)

**Area:** godot-client
**Status: DONE (05.11.26 — Godot suite 25855/0 (+18 model asserts), boot check OK; used on the second dev box's operator screens: loupe, pick, panel, copy → paste verified) — owner QA**

Owner 05.11: *"add a color picker/probe to available apps so users can easily grab a color from exisitnig graphics etc."* (with a lower-third template whose name says the colour still has to be matched).

Related: [WO-628](./628_WO_operator_dock.md) (the dock), the per-screen overlay pattern of `app/operator_screen_picker.gd` (WO-868), [WO-621](./621_WO_godot_owner_notes_live_looks_previs.md) (icon set).

## 1. Investigation

- "Available apps" is the operator dock: five curated tools + any installed desktop app (`app:<desktop-id>`, `src/utils/desktop-app-catalog.js`), launched by the server.
- An installed picker (gpick, kcolorchooser) would need apt + sudo on every box (none here: `sudo -n` refused) and an ISO package-list change. A picker inside the Godot client ships with the normal update (the kiosk runs the client from source) and works the same on every box.
- Godot 4.7 on X11 reads the screens (`DisplayServer.screen_get_image`) and writes the clipboard (`clipboard_set`, already used by the logs dialog).
- **Live finding while building it:** one borderless always-on-top window per screen (the screen-picker pattern) gets pointer events only on the **focused** one — measured with a debug print: both windows drew, keys reached the focused one, motion only reached the window on HDMI-0; a Control's `gui_input` and `Window.window_input` got nothing on the other. The overlay is therefore ONE window over the union of all screens. (The XFixes pointer barriers of WO-279/391 are not involved: they bound DP-2 + HDMI-0, where both overlays were.)

## 2. What was done

- `app/colour_probe_model.gd` (new, pure): `formats` — HEX `#RRGGBB`, Caspar colour `#FFRRGGBB` (`PLAY 1-10 #FF…`), RGB 0–255, 0–1 floats (shaders), HSV; `sample(img, p, radius)` (radius 2 = the 5×5 mean, clipped at the edges); `remember` (recent picks, newest first, no repeats, 10); `ink`.
- `app/colour_picker.gd` (new): `pick()` hides the panel, grabs every screen, composes them at their places into one image, shows it in one borderless always-on-top window (crosshair cursor) with a magnifier (11 × 11 px at 12×, centre marked, swatch + HEX under it, flipped at the edges); click = pick, Esc / right-click = cancel. The panel (always on top, bottom-centre of the screen, built hidden so the WM does not place it first) shows the swatch, "Pick a colour", "Average 5×5 (soft edges, video)", one read-only field + copy button per format, the recent picks (click = show + copy HEX) and the last action. History and the average switch are kept in `user://ui.cfg [colour_picker]`. Nothing goes to the server.
- `app/operator_dock.gd`: a built-in "Colour picker" button (eyedropper) right after HighAsCG — collapses the dock (out of the frozen picture) and picks; the picker node is made on first use under the root.
- `assets/ui/icons/eyedropper.svg` (new, 24×24 white, the icon set's style).

## 3. What was verified

- `tests/test_colour_probe_model.gd`: formats of #50ADCC (the template's end-bar blue), hue 0 not 360, pixel / 3×3 mean / corner-clipped mean / out-of-range sample, history cap / order / no duplicates, ink. Godot suite **25855 passed, 0 failed**; `run-client.sh --check` boot OK.
- **Box (highascg5867, both operator monitors):** dock → eyedropper: one overlay 3840×1080 at 0,0; loupe over the FTB button read **#AD392D**; click → panel at the bottom centre: HEX #AD392D, Caspar #FFAD392D, RGB 173, 57, 45, 0–1 0.678, 0.224, 0.176, HSV 6°, 74%, 68%, Recent swatch; Copy HEX → "Copied #AD392D", Ctrl+V into a text field gave `#AD392D`.
- Not checked: screens of different sizes / a mirrored layout (the union image fills gaps black), and picking on a playout head when the pointer confine keeps the mouse on the operator monitors (the confine bounds where the pointer can go — the frozen picture of those screens is still taken).
