# WO-1015 — Operator dock: the eyedropper opens a real colour picker app (Gpick)
**Area:** godot-client, os-iso
**Status: IN PROGRESS (09.11) — waiting for `sudo apt install gpick` on the box**

Owner, 09.11 (verbatim):
> the color picker has no gui.
> find an opensource color picker on github for ubuntu and make it work from the dock

Related: [WO-950](./950_WO_dock_colour_picker.md) (the built-in picker it replaces on boxes that have Gpick), [WO-628](./628_WO_operator_dock.md) (the dock), WO-387 (installed apps as `app:<desktop-id>`).

## Investigation

- The dock's eyedropper (WO-950) is a built-in in-client picker: a frozen full-screen overlay, then a small result
  panel. There is no picker window you can open and keep using, which is the "no gui" the owner means.
- Candidates on GitHub that Ubuntu packages (`apt-cache policy` on this box, 26.10):
  - **Gpick** (github.com/thezbyg/gpick, BSD-3), apt `gpick` 0.2.6. A full GTK window: a screen picker with a
    magnifier (Space picks under the cursor), a palette and history, colour mixing, and copy as HEX / RGB / HSV / CSS.
    **Chosen.**
  - Gcolor3 (github.com/Hjdskes/gcolor3; the repo is archived) and KColorChooser (KDE, pulls in KF6). Both are still
    accepted as fallbacks.
- Every installed `.desktop` app is already a dock app, `app:<desktop-id>` (WO-387). So Gpick launches and focuses
  through the existing `/api/system/dock/launch` path, behind the same nuclear-password gate, with no server change.
- Installing it needs root, and this box has no passwordless apt, so the owner runs the install. ISOs are cloned from
  the box, so they pick it up once it is installed. `scripts/setup/17-operator-tools.sh` lists it for fresh installs.

## What was done

- `godot/client/app/operator_dock_model.gd`: `PICKER_APPS` (Gpick, then GNOME Eyedropper, Gcolor3, KColorChooser) and
  `picker_app(apps)`, which returns the best installed one, or "".
- `godot/client/app/operator_dock.gd`: once the app list loads, the eyedropper opens the installed picker the way any
  dock app opens (launch or focus, with a running dot under the icon). With none installed, it still runs the built-in
  WO-950 picker.
- `scripts/setup/17-operator-tools.sh`: `gpick` is in the apt list and the verify lines.
- `godot/client/tests/test_operator_dock_model.gd`: `test_picker_app_prefers_gpick_else_built_in`.

## What was verified

- Godot suite: 26525 passed, 0 failed. `--check`: boot OK.
- Live: pending the install and a GUI relaunch.
