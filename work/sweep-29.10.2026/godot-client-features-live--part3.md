# godot/client/features/live — sweep 29.10.2026 (batch 031)

Files: 3 · lines: 432 · findings: 0 BUG-HIGH, 1 BUG, 0 DEAD, 1 RISK, 0 QUALITY

## godot/client/features/live/transitions.gd
- `BUG` godot/client/features/live/transitions.gd:25-26 — `migrate_type` ports `.replace(/\s*\+\s*MERGE\b/gi, '+ ANIMATE')` literally (client/lib/transition-presets.js:44); the pattern eats the space before `+`, so the legacy `"MIX + MERGE"` becomes `"MIX+ ANIMATE"`, which is in no type list. Consequence: `normalize_for_pgm_only({type:"MIX + MERGE"})` → CUT with duration 0 and transition_row.gd:27 shows CUT, i.e. a stored legacy MERGE transition silently turns into a cut. The golden test pins the wrong result (godot/client/tests/test_transitions_timer.gd:11 `[{"type": "MIX + MERGE"…}, {"type": "CUT"…}]` and :19 `["MIX + MERGE", "MIX+ ANIMATE"]`), so the migration has never worked in either client. Fix in JS and GDScript: replace with `' + ANIMATE'` (keep the leading `\s*\+` match but re-insert the space), then update the golden expectations. Impact depends on whether any legacy `+ MERGE` data still exists.
## godot/client/features/live/usb_import_dialog.gd
- `RISK` godot/client/features/live/usb_import_dialog.gd:32-36 — the dialog is a process-wide singleton (`static var _shown`) and `imported` is connected to `on_imported` only when it is first created; later `show_import(host, other_callable)` calls (e.g. from a rebuilt media panel) keep the first callable, and once the first panel is freed Godot drops that connection, so a finished import no longer triggers `load_media()` on the new panel. Reconnect when the callable differs (`is_connected` check + disconnect old).
## godot/client/features/live/usb_import_model.gd
- `OK`
