# godot/client/features/audio — sweep 29.10.2026 (batch 025)

Files: 14 · lines: 2610 · findings: 0 BUG-HIGH, 0 BUG, 3 DEAD, 0 RISK, 5 QUALITY

Context checked: signal signatures of `Store.changed(path, value)`, `Store.project_changed(project)`, `Settings.changed`, `Settings.loaded`, `LiveInputDialog.dirty/added`
match every `.connect(...)` in this batch; `ctl.bind()` guards the optional signals with `has_signal`; `audio_rows.bus_channel_count` returns 2 for a PRV
channel exactly like the web twin (`client/lib/program-audio-layouts.js:131-136`, mainIdx < 0 → stereo), so that is parity, not a bug. Unused-symbol sweep done
with `grep -rnw` over godot/ tools/ (own-file count vs other files, tests split out).

## godot/client/features/audio/audio_actions.gd
- `OK`

## godot/client/features/audio/audio_console_ctl.gd
- `OK`

## godot/client/features/audio/audio_dock.gd
- `OK`

## godot/client/features/audio/audio_dock_master.gd
- `OK`

## godot/client/features/audio/audio_dock_model.gd
- `DEAD` godot/client/features/audio/audio_dock_model.gd:60 `routes_inline()` + `INLINE_ROUTES` (:14) — no production caller; `audio_dock_row.gd` always puts the routing toggles one per line in a `VBoxContainer` (:138-152) since the vertical redesign. grep: `grep -rnw "routes_inline\|INLINE_ROUTES" godot tools` → the definitions and `tests/test_audio_dock.gd:53` only. Fix: delete both and the test line, or use it.
- `DEAD` godot/client/features/audio/audio_dock_model.gd:15 `COLUMN_W` — only referenced by `tests/test_audio_dock.gd:61,87` (fit-in-400px assertions). Not production code; keep only if the test is wanted as a layout guard (then say so in the comment).

## godot/client/features/audio/audio_dock_row.gd
- `DEAD` godot/client/features/audio/audio_dock_row.gd:36 `var _nosig := false` — never read or written. `set_input_state()` (:259) drives `level.no_signal` instead. grep: `grep -n "_nosig" godot/client/features/audio/audio_dock_row.gd` → the declaration only (the other `_nosig` hits in the repo are `audio_strip.gd`'s own Label). Fix: delete the line.
- `QUALITY` godot/client/features/audio/audio_dock_row.gd:215-243 (also audio_strip.gd:326-355 and audio_dock_master.gd:79-105) — `_on_value`, `_on_fader_input`, `set_gain`, `gain` and the `drag_started/drag_ended` wiring are copied verbatim three times (≈35 lines each), including the subtle "double-click release ends a drag it never saw" handling. A fix to one (e.g. the unity quantisation in `gain()`) has to be made in three places. Fix: one small helper/base (a `FaderBinding` RefCounted that owns a VSlider and emits `gain_changed`).

## godot/client/features/audio/audio_meter_model.gd
- `QUALITY` godot/client/features/audio/audio_meter_model.gd:23,28,256 (and 133-135) — `RegEx.create_from_string(...)` is compiled on every call of `_int()`, `_pf()` and `read_key()`, and these run per strip per 50 ms meter tick (`audio_tab.gd:_process`, `audio_dock.gd:_process`): `read_key` compiles the bus regex for every non-layer key, `is_layer_on_air` calls `_int(k)` for every OSC layer of the channel (:133-135) for every layer strip whose layer is not on air, `info_layer_has_hints` compiles three `_pf`. With the Audio tab and the dock both visible that is on the order of 1-2k regex compilations per second (not measured). Fix: hoist the patterns into `static var _RE_INT := RegEx.create_from_string(...)` etc.

## godot/client/features/audio/audio_rows.gd
- `QUALITY` godot/client/features/audio/audio_rows.gd:39-44 — `shorten_media_name()` compiles two fixed regexes plus all 7 `_DROP` patterns per token, for every row, on every `_refresh()` of the tab and of the dock (`ctl.rows()` is rebuilt on each `scene*` / `audioMixer` / project change). Same remedy as above: precompile once (`static var`).

## godot/client/features/audio/audio_strip.gd
- `OK` (the duplication with audio_dock_row.gd / audio_dock_master.gd is reported under audio_dock_row.gd)

## godot/client/features/audio/audio_tab.gd
- `QUALITY` godot/client/features/audio/audio_tab.gd:109-113 — the "does the strip list need a rebuild" signature is re-implemented inline (`[programs, screen_labels, audioPreviewCh]` + per-row `[key,label,sceneId,bars,liveAudioSlot]`) while the dock uses `DM.shape()` (audio_dock_model.gd:65). The two lists are meant to stay in step (comment audio_console_ctl.gd:7-8 "so the two surfaces can never drift") but the rebuild condition already differs (tab adds `audioPreviewCh`, dock does not). Fix: give `DM.shape` an `extra` argument and call it from both.

## godot/client/features/audio/audio_tab_split.gd
- `OK`

## godot/client/features/audio/fader_cap.gd
- `OK`

## godot/client/features/audio/layer_levels.gd
- `QUALITY` godot/client/features/audio/layer_levels.gd:28,40,43,120-123 — reaches into `audio_meter_model.gd`'s underscore-private statics (`AM._fin`, `AM._dict`). They are public in effect; rename them (`fin`, `as_dict`) or move to a shared helper so the underscore convention keeps meaning "file-private".

## godot/client/features/audio/meter_bank.gd
- `OK`
