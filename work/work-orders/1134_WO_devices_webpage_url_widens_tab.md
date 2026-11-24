# WO-1134 — Devices tab wider than the window again: a webpage input's URL pinned the column

**Area:** godot-client
**Status: DONE (24.11.26 — Godot suite 30123 passed / 0 failed; glass: Devices fits 1920 px with the Inspector at x≈1527, URL trimmed with "…")**

Owner, 24.11: *"the devices tab is weirdly stretched so i cant even see the inspector inside it"*

## 1. Investigation
- Screenshot (Devices, 24.11 10:19): the Screen destinations column ran from x 316 to 1170, the rear panel and the
  top bar's right side were cut at 1920, and the Inspector was gone. The column's right edge sat exactly where the
  "Add live input" band's row ended: `https://wall.sli.do/event/666NHN…&utm_source=slidoadmin (CG)` / `Webpage`
  (the project's webpage live input, `config/general.json` value / label).
- `features/devices/destinations_panel.gd` `_show_band()` builds each band row as a `Button` with
  `"%s\n%s" % [label, detail]` and no `clip_text`. A Button's minimum width is its full text, so this ~850 px URL
  became the column minimum. Devices + Sources + the 400 px Inspector then came to more than 1920. Same class as WO-977
  (an unclipped Playlists dropdown) and WO-750: latent, and it appears with whatever long text a project holds.

## 2. What was done
- `destinations_panel.gd`: band buttons `clip_text = true` + `OVERRUN_TRIM_ELLIPSIS`. The tooltip now carries the full
  label + detail (plus "Open this connector's settings" when the row is clickable).
- `tests/test_devices_live_band_width.gd`: a real Button with the URL pins > 600 px unclipped and < 100 px clipped;
  source pins for the clip, the ellipsis and the tooltip text.

## 3. Verified
- `run-client.sh --test`: 30123 passed, 0 failed (new suite: 5 passed).
- Glass: GUI relaunched (run-client.sh --autostart, setsid), Devices tab: whole page inside 1920 px, the rear
  panel with STREAM / RECORD / AUDIO columns visible, Inspector column at the right ("Select an item"), the band row reads
  `https://wall.sli.do/event/666NHNXvJHSGbsRCRiSpEK…`. Live tab unchanged. The looks editor was reopened (Cosy)
  for the WO-1133 soak; node logged `ADD 3-742 SHM NAME prv1`.
