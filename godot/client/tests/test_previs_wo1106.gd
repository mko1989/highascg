extends RefCounted
## WO-1106 — review fixes in the previs: one canonical drape colour shared with the Node twin (A42), the colour
## picker's drag only tints until it closes (A43), and the pad flies the camera only while this window has the focus
## (B25).

const S := preload("res://features/previs/stage_objects.gd")
const B := preload("res://features/previs/stage_builder.gd")
const DrapeUi := preload("res://features/previs/drape_ui.gd")
const Stage := preload("res://features/previs/previs_stage.gd")
var t


func test_drape_colour_has_one_canonical_form() -> void:
	t.eq(S.drape_color("#fff"), "#ffffff", "#rgb → #rrggbb (src/stage/drape-geometry.js read it as black)")
	t.eq(S.drape_color("#1b244280"), "#1b2442", "#rrggbbaa → opaque #rrggbb")
	t.eq(S.drape_color("#abcd"), "#aabbcc", "#rgba → #rrggbb")
	t.eq(S.drape_color("#1B2442"), "#1B2442", "#rrggbb kept as given")
	t.eq([S.drape_color("red"), S.drape_color(""), S.drape_color(null)], ["#151515", "#151515", "#151515"], "not a # colour → black")
	t.eq(S.normalize({"type": "drape", "color": "#fff"}).color, "#ffffff", "normalize stores the canonical form")
	# the Node twin (src/stage/drape-geometry.js colorOf) reads the same forms: tools/smoke/smoke-wo1106-godot-previs.test.js


func test_picker_drag_tints_and_commits_on_close() -> void:
	var calls := []
	var row := DrapeUi.color_row({"color": "#151515"}, func(hex: String, done: bool) -> void: calls.append([hex, done]))
	var pick: ColorPickerButton = null
	for c in row.get_children():
		if c is ColorPickerButton:
			pick = c
	t.ok(pick != null, "the picker")
	pick.color = Color.html("#5a1622")
	pick.color_changed.emit(pick.color)
	t.eq(calls, [["#5a1622", false]], "a drag tick: a live preview only")
	pick.popup_closed.emit()
	t.eq(calls, [["#5a1622", false], ["#5a1622", true]], "closed on a new colour: committed once")
	row.free()
	calls.clear()
	var row2 := DrapeUi.color_row({"color": "#151515"}, func(hex: String, done: bool) -> void: calls.append([hex, done]))
	for c in row2.get_children():
		if c is ColorPickerButton:
			(c as ColorPickerButton).popup_closed.emit()
	t.eq(calls, [], "closed without a change: nothing saved")
	row2.free()
	var b := B.new(func(_role: String) -> Texture2D: return null)
	b.set_objects([S.normalize({"id": "drape_1", "type": "drape"})])
	var mi := b.node_for("drape_1").find_children("*", "MeshInstance3D", true, false)[0] as MeshInstance3D
	var mesh := mi.mesh
	b.tint("drape_1", "#5a1622")
	t.eq((mi.material_override as ShaderMaterial).get_shader_parameter("albedo"), Color.html("#5a1622"), "tinted")
	t.ok(mi.mesh == mesh and is_instance_valid(mi) and str(b.objects[0].color) == "#151515", "same pleat mesh, the object not edited")
	b.tint("nope", "#ffffff")  # an unknown id: nothing
	b.free()
	var panel := FileAccess.get_file_as_string("res://features/previs/stage_panel.gd")
	t.ok(panel.contains("if not done:  # WO-1106 A43") and panel.contains("builder.tint(id, hex)"), "the Stage panel tints while dragging")


func test_pad_flies_only_a_focused_window() -> void:
	t.eq(Stage.pad_window_focused(null), false, "no window")
	var w := Window.new()
	t.eq(Stage.pad_window_focused(w), false, "a window without the focus (the retro game has it)")
	w.free()
	var src := FileAccess.get_file_as_string("res://features/previs/previs_stage.gd")
	t.ok(src.contains("not is_visible_in_tree() or not pad_window_focused(get_window()):"), "the pad step is gated on it")
