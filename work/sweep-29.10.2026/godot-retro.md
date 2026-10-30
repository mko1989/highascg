# godot/retro — sweep 29.10.2026 (batch 046)

Files: 4 · lines: 230 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 1 RISK, 2 QUALITY

Context: WO-745. Callers found: `tools/e2e/retro-source.sh` (needs `godot/retro/install.sh`), `src/api/routes-shm-sources.js` (mentions HshmSink/RetroHost). `run-retro.sh` is operator-run by hand (docs and `project.godot` comment only), which is by design. `~/.local/opt/godot/godot` exists on this box.

## godot/retro/install.sh
- `RISK` godot/retro/install.sh:8,13 — only `template_debug` is built, but the `.gdextension` files list release libraries too. A `godot --export-release` or a release template binary would find no library. The window is run with a normal (debug-template) Godot binary, so no failing case today.

## godot/retro/retro_keys.gd
- `OK` — mapping checked against RetroArch's default keyboard (X=A, Z=B, S=X, A=Y, Q=L, W=R, Enter=Start, Shift=Select) and libretro ids B=0 … R=11. `RETRO_DEVICE_ID_JOYPAD_*` ids match. All constants are used.

## godot/retro/retro_window.gd
- `QUALITY` godot/retro/retro_window.gd:133-143 — `_unhandled_key_input` has no focus-loss handling: if the window loses focus while a key is held, the key stays in `_keys_down` and the core keeps the button pressed until the key is pressed and released again. Whether Godot delivers a synthetic release on focus-out is not established here, so this is not reported as a BUG.

## godot/retro/run-retro.sh
- `QUALITY` godot/retro/run-retro.sh:1-5 — no `set -e` / existence check for `$GODOT`; `exec` of a missing binary prints a bare "No such file or directory". Works as intended otherwise (box path exists).
