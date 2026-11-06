# WO-977 — Devices tab wider than the window: Inspector pushed off the right edge

**Area:** godot-client
**Status: DONE (06.11.26 — min-width probe Inspector 622 → 400 px; glass: Devices (nothing selected / DP 2/3 open) and Live, Inspector fully inside 1920)**

## Owner report (06.11.26)
On Devices the Inspector starts at x≈1400 and is clipped at 1920; on Live it starts at x≈1305 and fits.

## 1. Investigation
Measured with the existing dev probe `--probe-min-width=Devices` (`app/min_width_probe.gd`, WO-911) on the real client:
- Workspace TabContainer (Devices) minimum **1088 px** (rear panel column 490 + screen destinations + mapping nodes;
  leaf `Label "DP 6/7 · DP-6 (no mode)"`). Not the toolbar, not the GPU-output toggle row (so WO-975's " (auto)" is
  innocent): 1088 on its own fits.
- **Inspector** (PanelContainer) minimum **622 px**, not its declared 400: leaf is the Playlists footer's
  `OptionButton` (`features/live/playlists_panel.gd`, `_list`) holding the clip name
  "abstract-falling-neon-lines-background-animation-2026-10-03-…" — an OptionButton without `clip_text` has its whole
  text as minimum width (`fit_to_longest_item = false` only affects items beyond the current one).
- Budget: 1920 − Sources 280 = 1640 for tabs + Inspector. 1088 + 622 = 1710 > 1640, so the right HSplit (both sides at
  minimum) overflows by ~70 px. On Live the tab is narrow so the split gives the Inspector 615 px and it just fits
  (the dropdown arrow already sat 7 px from the edge). Same class as WO-911.
- Regression? Not a single commit: `playlists_panel.gd` dates from WO-603 and is untouched recently. It is latent and
  data-dependent: it appears once a playlist's clip name is long (the project's "abstract-falling-neon…" playlist) and
  the active tab's minimum exceeds ~1018 px (Devices 1088). Not caused by WO-975 / 2f547d49.

## 2. What was done
- `features/live/playlists_panel.gd`: `_list.clip_text = true`, `_items.clip_text = true` — the dropdowns trim to the
  column; the Inspector's minimum is its declared 400 px on every tab.
- `tests/test_inspector_column_width.gd`: a long-named OptionButton pins >400 px unclipped and ≤400 clipped; source pin
  that both Playlists dropdowns clip. (The panel itself needs the `Api` autoload, absent in the test runner.)
- No shell-level guard: a generic cap cannot override children's minimums without a ScrollContainer around every tab;
  the probe is the tool for the next report. The Devices tab's own 1088 px was left (fits with a 400 px Inspector).

## 3. Verified
- Godot suite: 26049 passed, 0 failed. `check-max-file-lines`: 0 over.
- Probe after the fix (`--probe-min-width=Devices`): Inspector min 400 (was 622); tab 1088, size 1216.
- Glass (GUI relaunched under the box2 lock, left on the Live tab): Devices with nothing selected, Devices with the
  DP 2/3 GPU port open (Inspector x≈1522, whole GPU page and Playlists footer inside 1920) and Live (Inspector
  x≈1522). Screens (left 1920 px): scratchpad `wo977_devices.png`, `wo977_dp2.png`, `wo977_live.png`.
- Not proven: other tabs' interplay with a long clip name beyond Live/Devices (the fix removes the pinning leaf for all).
- Side note: in the DP 2/3 page a row of "CVT (default)" + slider ends with a clipped "SL…" at the right edge of the
  Inspector scroll area; inside the column, not an overflow of the shell.
