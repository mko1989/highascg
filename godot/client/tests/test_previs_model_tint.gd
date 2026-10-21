extends RefCounted
## WO-641 — model_tint.gd (previs colour overrides) and color_rows.gd.

const Tint := preload("res://features/previs/model_tint.gd")
const ColorRows := preload("res://features/previs/color_rows.gd")
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
