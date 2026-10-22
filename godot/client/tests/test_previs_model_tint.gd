extends RefCounted
## WO-641 — model_tint.gd (previs colour overrides) and color_rows.gd.

const Tint := preload("res://features/previs/model_tint.gd")
const ColorRows := preload("res://features/previs/color_rows.gd")
const MvrModel := preload("res://features/previs/mvr_model.gd")
var t


func test_parse_and_maps() -> void:
	t.eq(Tint.parse("#ff8000"), Color.html("#ff8000"))
	t.eq([Tint.parse(null), Tint.parse(""), Tint.parse("red"), Tint.parse("#zz0000")], [null, null, null, null], "only #hex")
	t.eq(Tint.hex(Color(1, 0, 0)), "#ff0000")
	t.eq(Tint.colors({"layer_colors": {"Truss": "#000000"}}, "layer_colors"), {"Truss": "#000000"})
	t.eq([Tint.colors(null, "x"), Tint.colors({"x": 3}, "x")], [{}, {}], "missing or wrong shape → {}")
	var m := {"A": "#111111"}
	t.eq(Tint.with_color(m, "B", Color(1, 1, 1)), {"A": "#111111", "B": "#ffffff"})
	t.eq(Tint.with_color(m, "A", null), {}, "null clears")
	t.eq(m, {"A": "#111111"}, "input untouched")


func test_apply_and_restore() -> void:
	var root := Node3D.new()
	var body := MeshInstance3D.new()
	var own := StandardMaterial3D.new()
	body.material_override = own
	root.add_child(body)
	var plain := MeshInstance3D.new()  # GLB mesh: its materials live on the mesh, no override
	root.add_child(plain)
	var lens := MeshInstance3D.new()
	var lmat := StandardMaterial3D.new()
	lens.material_override = lmat
	lens.set_meta("no_tint", true)
	body.add_child(lens)
	Tint.apply(root, Color(0, 0, 1))
	t.eq((body.material_override as StandardMaterial3D).albedo_color, Color(0, 0, 1), "tinted")
	t.eq((body.material_override as StandardMaterial3D).cull_mode, BaseMaterial3D.CULL_DISABLED, "two-sided like the GLB's own (WO-677)")
	t.ok(body.material_override != plain.material_override, "each mesh its own material (Glow bodies light theirs)")
	t.eq(lens.material_override, lmat, "no_tint left alone")
	Tint.apply(root, Color(0, 1, 0))
	Tint.apply(root, null)
	t.eq([body.material_override == own, plain.material_override == null], [true, true], "the model's own materials come back")
	root.free()


func test_rows_keep_the_picker_on_same_names() -> void:
	var r := ColorRows.new()
	r.fill(["Truss", "Set"], {"Truss": "#ff0000"})
	var first := r.get_child(0)
	var picks := r.find_children("*", "ColorPickerButton", true, false)
	t.eq([picks.size(), (picks[0] as ColorPickerButton).color, (picks[1] as ColorPickerButton).color],
		[2, Color(1, 0, 0), ColorRows.UNSET], "set colour / unset grey")
	r.fill(["Truss", "Set"], {})
	t.ok(r.get_child(0) == first, "same names: rows kept (an open picker survives its own save)")
	t.eq((picks[0] as ColorPickerButton).color, ColorRows.UNSET, "swatch updated")
	var got := []
	r.changed.connect(func(n: String, c: Variant) -> void: got.append([n, c]))
	(r.find_children("*", "Button", true, false).filter(func(b: Node) -> bool: return (b as Button).text == "↺")[1] as Button).pressed.emit()
	t.eq(got, [["Set", null]], "↺ clears")
	r.free()


func test_layer_rows_eyes_and_highlight() -> void:  # WO-647
	var rows := ColorRows.new()
	rows.eyes = true
	var shown := []
	rows.visibility_toggled.connect(func(n: String, on: bool) -> void: shown.append([n, on]))
	rows.fill(["Truss", "Walls"], {}, {}, ["Walls"])
	var eye_t: Button = rows._rows["Truss"][2]
	var eye_w: Button = rows._rows["Walls"][2]
	t.eq([eye_t.button_pressed, eye_w.button_pressed], [true, false], "a hidden layer shows a closed eye")
	eye_t.button_pressed = false
	t.eq(shown, [["Truss", false]], "the eye hides the layer")
	rows.highlight(["Walls"])
	var lit: StyleBox = (rows._rows["Walls"][3] as PanelContainer).get_theme_stylebox("panel")
	var off: StyleBox = (rows._rows["Truss"][3] as PanelContainer).get_theme_stylebox("panel")
	t.eq([(lit as StyleBoxFlat).border_color.a > 0, (off as StyleBoxFlat).border_color.a], [true, 0.0], "only the selected object's layer is marked")
	t.eq(lit.get_minimum_size(), off.get_minimum_size(), "lighting a row does not move the list")
	rows.fill(["Truss", "Walls"], {}, {}, [])
	t.ok((rows._rows["Walls"][3] as PanelContainer).get_theme_stylebox("panel") is StyleBoxFlat, "a reload keeps the mark")
	t.eq(eye_w.button_pressed, true, "and follows the project")
	var plain := ColorRows.new()
	plain.fill(["A"], {})
	t.eq(plain._rows["A"][2], null, "no eye unless asked (fixture Body colour)")
	rows.free()
	plain.free()
	t.eq(MvrModel.layers_of(["a", "b", "c"], func(u: String) -> String: return {"a": "Truss", "b": "Truss", "c": ""}[u]), ["Truss", ""])


## WO-678 — a patched head takes its MVR layer's colour unless its type has a Body colour; picking it lights its layer.
func test_heads_follow_their_layer() -> void:
	const F := preload("res://features/previs/fixtures/fixtures_3d_model.gd")
	t.eq(MvrModel.fixture_uuids(["mvr-ab12", "hand-1", "mvr-cd34"]), ["ab12", "cd34"], "only fixtures patched from the MVR")
	var layer_of := func(u: String) -> String: return {"ab12": "Sharpy", "cd34": "Robin"}.get(u, "")
	var layers := {"Sharpy": "#000000"}
	t.eq([F.head_color("mvr-ab12", "T1", {}, layers, layer_of), F.head_color("mvr-cd34", "T2", {}, layers, layer_of),
		F.head_color("hand-1", "T1", {}, layers, layer_of)], [Color.BLACK, null, null], "the layer's colour, MVR heads only")
	var types := {"T1": "#ff0000"}
	t.eq([F.head_color("mvr-ab12", "T1", types, layers, layer_of), F.head_color("hand-1", "T1", types, layers, layer_of)],
		[Color.RED, Color.RED], "the type's Body colour wins")
