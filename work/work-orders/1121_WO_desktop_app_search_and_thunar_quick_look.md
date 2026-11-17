# WO-1121 — Desktop quality of life: Super+Space app search, Space quick look in Thunar

**Area:** godot-client
**Status: DONE (17.11.26 — both on the glass with rofi + mpv installed; installer / ISO wiring open)**

Owner 17.11: "quality of life features to the system. super+space input box to search apps. in thunar space should
show a quick preview of video files and image files."

## Investigation

- The X session is openbox (`~/.config/openbox/rc.xml`, hand-kept on the box, cloned into the ISO; no `W-space`
  keybind) with Thunar 4.20 (`~/.config/Thunar/uca.xml` custom actions, `accels.scm`).
- Installed: ffplay, xdotool. Not installed: rofi / dmenu / wofi / xfce4-appfinder, mpv, any image viewer.
- `ibus-daemon` runs with its own trigger `<Super>space` (gsettings org.freedesktop.ibus.general.hotkey triggers).

## What was done

- `scripts/desktop/app-search.sh` — rofi `drun` with icons, fuzzy match; a notification when rofi is missing.
- `scripts/desktop/quicklook.sh <file>` — mpv preview window (60 %, on top, muted — playout box, `m` unmutes — looped,
  Space / Esc / q close); a second Space in Thunar closes it too (pid file); ffplay fallback without mpv (Esc / q).
- `scripts/setup/desktop-quality-of-life.sh` (as the session user, re-runnable): openbox keybind `W-space` → app
  search; Thunar action "Quick look" for video + image files with the accelerator `space`; IBus trigger emptied;
  `openbox --reconfigure`. It quits Thunar first (Thunar rewrites accels.scm on exit).
- Run on this box; backups `rc.xml.pre-wo1121`, `uca.xml.pre-wo1121`.

## What was verified

- Both config files parse as XML. On the glass: Thunar on the project folder, a PNG selected, Space → preview
  window with the picture (screenshot), Esc closes it; the script's own second call closes an open preview.

## After the owner installed rofi + mpv (17.11)

- Super+Space opens the search (typed "local" → LocalSend). The default cream theme replaced by a complete dark theme
  `scripts/desktop/app-search.rasi`; owner: "make the search window to extend from the dock up" → anchored bottom
  centre, the input at the bottom, matches listed upward (screenshot).
- Thunar: Space on a PNG opens the mpv preview, Space again closes it.

## Not verified / open

- A video file in quick look, and launching an app from the search (Enter), were not tried.
- Space in Thunar's list view normally toggles the selection of the focused row; with the accelerator it previews
  instead. A video file was not tried.
- The ISO: rofi + mpv must be on the box before the next eggs build; the setup script is not called by any
  installer step yet.
