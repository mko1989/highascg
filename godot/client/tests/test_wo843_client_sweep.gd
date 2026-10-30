extends RefCounted
## WO-843 — fixes from the 29.10 sweep (Godot client): ui.cfg splitter save, media-inspector trim fields, "+ MERGE"
## migration, previs Delete in Camera mode, pixel-map click at zoom, duplicate output ids, debounce-before-retarget.

const UiCfg := preload("res://core/ui_cfg.gd")
const Trim := preload("res://features/live/clip_trim_model.gd")
const T := preload("res://features/live/transitions.gd")
const PK := preload("res://features/previs/previs_keys.gd")
const PM := preload("res://features/previs/fixtures/pixel_map_model.gd")
const O := preload("res://features/devices/output_ports_model.gd")
const MG := preload("res://features/devices/mapping_graph.gd")
var t


func _tmp(name: String) -> String:
	return OS.get_cache_dir().path_join("wo843_%s_%d.cfg" % [name, Time.get_ticks_usec()])


# --- 4f: the splitter writes into the file as it is NOW, not as it was when the tab was built ------------------------

func test_splitter_keeps_keys_written_since_tab_build() -> void:
	var path := _tmp("split")
	var built := ConfigFile.new()  # what the old code held for the whole session
	built.load(path)
	var other := ConfigFile.new()  # haze / folds / password written later, by other code
	other.set_value("previs", "haze", 0.7)
	other.set_value("previs_folds", "Lights", false)
	other.set_value("auth", "passwords", {"http://x": "secret"})
	other.save(path)
	UiCfg.save_value("timeline", "preview_h", 333, path)
	var got := ConfigFile.new()
	t.eq(got.load(path), OK, "file readable")
	t.eq(got.get_value("timeline", "preview_h"), 333, "offset stored")
	t.eq(got.get_value("previs", "haze"), 0.7, "haze survived")
	t.eq(got.get_value("previs_folds", "Lights"), false, "fold survived")
	t.eq(got.get_value("auth", "passwords"), {"http://x": "secret"}, "password survived")
	t.eq(built.get_value("previs", "haze", "none"), "none", "(control) the stale copy never saw the haze")
	DirAccess.remove_absolute(path)


func test_splitter_source_has_no_session_long_cfg() -> void:
	var src := FileAccess.get_file_as_string("res://features/timeline/timeline_tab.gd")
	t.ok(src.contains("UiCfg.save_value(\"timeline\", \"preview_h\", at)"), "drag saves through the load-modify-save helper")
	t.ok(not src.contains("cfg.save(UI_CFG))"), "no closure saving a ConfigFile captured at build")


# --- media inspector In / Out ----------------------------------------------------------------------------------------

func test_trim_field_unchanged_text_saves_nothing() -> void:
	# 1200 ms @ 25 fps is shown "0:01.05" (FF = frames); a blur on that text used to save 1050 ms.
	t.eq(Trim.field_patch("trimInMs", "0:01.05", "0:01.05", 25.0), {}, "blur without an edit")
	t.eq(Trim.field_patch("trimInMs", " 0:01.05 ", "0:01.05", 25.0), {}, "whitespace is not an edit")
	t.eq(Trim.field_patch("trimInMs", "", "", 25.0), {}, "empty stays empty")


func test_trim_field_ff_is_frames() -> void:
	t.eq(Trim.field_patch("trimInMs", "0:01.05", "", 25.0), {"trimInMs": 1200}, "m:ss.ff = frames, 1 s + 5 frames")
	t.eq(Trim.field_patch("trimOutMs", "1:02.12", "x", 25.0), {"trimOutMs": 62480}, "62 s + 12 frames @25")
	t.eq(Trim.field_patch("trimInMs", "1.5", "", 25.0), {"trimInMs": 1500}, "a plain number is seconds")
	t.eq(Trim.field_patch("trimInMs", "3*2", "", 25.0), {"trimInMs": 6000}, "maths (RULES.md)")
	t.eq(Trim.field_patch("trimInMs", "", "0:01.05", 25.0), {"trimInMs": null}, "cleared field clears the trim")
	t.ok(Trim.field_patch("trimInMs", "abc", "", 25.0).has("error"), "gibberish reverts")
	t.ok(Trim.field_patch("trimInMs", "1:-5", "", 25.0).has("error"), "signs are not salvaged (WO-839)")
	# what _sync writes parses back to the same frame
	var shown: String = Trim.M.format_timecode(1.2, 25.0)
	t.eq(Trim.field_patch("trimInMs", shown, "", 25.0), {"trimInMs": 1200}, "round trip")


# --- "+ MERGE" migration ----------------------------------------------------------------------------------------------

func test_merge_migrates_to_a_real_type() -> void:
	t.eq(T.migrate_type("MIX + MERGE"), "MIX + ANIMATE", "spaced")
	t.eq(T.migrate_type("MIX+MERGE"), "MIX + ANIMATE", "unspaced")
	t.ok(T.TYPES.has(T.migrate_type("WIPE  +  MERGE".to_upper())), "migrated name is in the type list")
	var n := T.normalize_for_pgm_only({"type": "MIX + MERGE", "duration": 8})
	t.eq(n.type, "MIX + ANIMATE", "no longer a CUT")
	t.eq(n.duration, 8, "duration kept")


# --- previs keys / pixel map click / ids ------------------------------------------------------------------------------

func test_camera_mode_takes_no_stage_keys() -> void:
	t.ok(PK.stage_keys("3d"), "3D")
	t.ok(not PK.stage_keys("camera"), "Camera mode")
	var src := FileAccess.get_file_as_string("res://features/previs/previs_tab.gd")
	t.ok(src.contains("KEY_DELETE, KEY_BACKSPACE when PrevisKeys.stage_keys(mode):"), "Delete is gated")
	t.ok(src.contains("KEY_D when PrevisKeys.stage_keys(mode)"), "Ctrl+D is gated")
	t.ok(src.contains("PrevisKeys.stage_keys(mode) and move_drag.key(k)"), "nudge keys are gated")


func test_click_is_not_a_drag_at_any_zoom() -> void:
	t.ok(not PM.drag_draws(Vector2(100, 100), Vector2(100, 100)), "no travel")
	t.ok(not PM.drag_draws(Vector2(100, 100), Vector2(102, 103)), "jitter under 4 px")
	t.ok(PM.drag_draws(Vector2(100, 100), Vector2(104, 100)), "4 px across")
	t.ok(PM.drag_draws(Vector2(100, 100), Vector2(100, 90)), "up 10 px")
	var src := FileAccess.get_file_as_string("res://features/previs/fixtures/pixel_map_view.gd")
	t.ok(not src.contains("_view_rect(_rect).size.x >= 4.0"), "no judging by the snapped rect's size")


func test_added_output_id_is_unused_after_a_middle_removal() -> void:
	var s := {"streamOutputs": [{"id": "str_1"}, {"id": "str_3"}], "recordOutputs": [{"id": "rec_2"}], "audioOutputs": [{"id": "audio_1"}, {"id": "audio_3"}]}
	t.eq(O.add_plan("stream_out", s).requests[0][2].streamOutputs[2].id, "str_4", "stream")
	t.eq(O.add_plan("record_out", s).requests[0][2].recordOutputs[1].id, "rec_3", "record")
	t.eq(O.add_plan("audio_out", s).requests[0][2].audioOutputs[2].id, "audio_4", "audio")
	t.eq(O.add_plan("stream_out", s).status, "Added stream output Str4", "label follows the id")


func test_added_mapping_output_id_is_unused() -> void:
	var g := {"devices": [{"id": "n1", "role": "pixel_mapping", "settings": {"outputs": [{"id": "out_1"}, {"id": "out_3"}]}}], "connectors": [], "edges": []}
	var r := MG.add_output(g, "n1")
	t.ok(r.ok, "added")
	var ids := []
	for o in MG.find_node(g, "n1").settings.outputs:
		ids.append(o.id)
	t.eq(ids, ["out_1", "out_3", "out_4"], "no second out_3")


# --- debounce is flushed before the target changes ------------------------------------------------------------------------

func _order(path: String, flush_pat: String, first_assign: String) -> bool:
	var src := FileAccess.get_file_as_string(path)
	var f := src.find(flush_pat)
	var a := src.find(first_assign, src.find("func show_layer"))
	return f > 0 and a > 0 and f < a


func test_pending_edit_is_flushed_before_retarget() -> void:
	t.ok(_order("res://features/live/countdown_section.gd", "_debounce.stop()\n\t\t_flush()", "_scene_id = scene_id"), "countdown")
	t.ok(_order("res://features/live/lower_third_section.gd", "_timer.stop()\n\t\t_flush()", "_scene_id = scene_id"), "lower third")
