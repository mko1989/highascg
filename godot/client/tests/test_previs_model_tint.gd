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


## WO-1001 — a click on a Layers row selects what it names: the row says so, the layer's objects are found, and its
## walls come out as if each were ctrl-clicked (clustered among the layer's own objects).
func test_layer_row_click_selects_its_objects() -> void:
	const W := preload("res://features/previs/mvr_screen_model.gd")
	var rows := ColorRows.new()
	var got := []
	rows.row_clicked.connect(func(n: String, add: bool) -> void: got.append([n, add]))
	rows.fill(["Truss", "Empty"], {}, {}, [], ["Empty"])
	var click := func(n: String, shift: bool) -> void:
		var mb := InputEventMouseButton.new()
		mb.button_index = MOUSE_BUTTON_LEFT
		mb.pressed = true
		mb.shift_pressed = shift
		(rows._rows[n][3] as PanelContainer).gui_input.emit(mb)
	click.call("Truss", false)
	click.call("Truss", true)
	click.call("Empty", false)
	t.eq(got, [["Truss", false], ["Truss", true]], "a click selects, shift adds; an empty layer has nothing to select")
	t.ok((rows._rows["Truss"][3] as PanelContainer).tooltip_text.contains("select"), "the row says it selects")
	var plain := ColorRows.new()
	plain.fill(["A"], {})
	t.eq((plain._rows["A"][3] as PanelContainer).tooltip_text, "", "fixture Body colours (nothing connected) stay plain rows")
	rows.free()
	plain.free()
	var sc := Node3D.new()
	for spec in [["a", "Truss", true], ["b", "Walls", true], ["c", "Truss", false], ["d", "Truss", true]]:
		var n := Node3D.new()
		n.set_meta("uuid", spec[0])
		n.set_meta("layer", spec[1])
		n.visible = spec[2]
		sc.add_child(n)
	var kids := sc.get_children()
	t.eq([W.on_layer(kids, "Truss"), W.on_layer(kids, "Truss", true), W.on_layer(kids, "Nope")], [["a", "d"], ["a", "c", "d"], []],
		"visible objects on the layer; `all` adds the hidden ones (patched heads)")
	sc.free()
	var box := func(x: float, y := 0.0, w := 0.5, h := 0.5) -> AABB: return AABB(Vector3(x, y, 0), Vector3(w, h, 0.1))
	var items := []
	for i in 4:  # a 2 m wall: 4 panels, each a face part and a body part, a bar on top; a lone leg off to the side
		items.append({"uuid": "f%d" % i, "key": "face", "box": box.call(i * 0.5)})
		items.append({"uuid": "b%d" % i, "key": "body", "box": box.call(i * 0.5)})
	items.append({"uuid": "bar", "key": "bar", "box": box.call(0.0, 0.5, 2.0, 0.2)})
	items.append({"uuid": "leg", "key": "leg", "box": box.call(9.0)})
	items.append({"uuid": "x", "key": "face", "box": box.call(2.0)})  # touching, but on another layer
	var layer := ["f0", "f1", "f2", "f3", "b0", "b1", "b2", "b3", "bar", "leg"]
	var walls := W.layer_walls(items, layer)
	t.eq(walls.size(), 1, "one wall, not one per part type (Narvill's 7 × 4 m Dioda came out as 70)")
	t.eq(walls[0].uuids, ["f0", "f1", "f2", "f3"], "its face: the largest same-model cluster, as a click on a panel picks; the other layer's panel stays out")
	var also: Array = walls[0].also.duplicate()
	also.sort()
	t.eq(also, ["b0", "b1", "b2", "b3", "bar", "leg"], "bodies, the bar and the lone leg ride along (hidden with it on Map)")
	t.eq(W.layer_walls(items, layer, {"f0": true, "f1": true, "f2": true, "f3": true, "b0": true, "b1": true, "b2": true, "b3": true, "bar": true, "leg": true}), [],
		"an already selected wall is not added twice")
	var two := W.layer_walls(items, ["bar", "leg"])
	t.eq(two.size(), 2, "no screen on the layer (truss bits): each connected group stays its own")


## WO-1002 — Fit to selection: the tracking grid covers the selected objects' PSN footprint, its floor at their top.
func test_tracking_stage_fits_the_selection() -> void:
	const TS := preload("res://features/previs/tracking/tracking_model.gd")
	t.eq(TS.grid_for([]), {}, "nothing selected, no grid")
	# a 6 × 4 m deck, 1 m high, centred 2 m stage left and 25 m upstage (Godot: z = -25), in two objects
	var deck := func(cx: float) -> Array: return [{"xf": Transform3D(Basis.IDENTITY, Vector3(cx, 0, -25)), "aabb": AABB(Vector3(-1.5, 0, -2), Vector3(3, 1, 4))}]
	var g := TS.grid_for([deck.call(0.5), deck.call(3.5)])
	t.eq(g, {"width": 6.0, "depth": 4.0, "x_offset": 2.0, "y_offset": 25.0, "z_offset": 1.0}, "footprint in PSN (Y upstage = −Godot Z), floor = the top")


## WO-1002 — picking hits triangles: from inside a venue shell the stage deck in front wins (box tests picked the shell).
func test_pick_hits_triangles_not_boxes() -> void:
	const W := preload("res://features/previs/mvr_screen_model.gd")
	var shell := MeshInstance3D.new()
	var big := BoxMesh.new()
	big.size = Vector3(40, 20, 40)
	shell.mesh = big
	var deck := MeshInstance3D.new()
	var small := BoxMesh.new()
	small.size = Vector3(6, 1, 4)
	deck.mesh = small
	deck.transform.origin = Vector3(0, -3, -10)
	var cache := {}
	var from := Vector3(0, 2, 0)
	var dir := (Vector3(0, -2.5, -10) - from).normalized()
	var d_shell := W.ray_distance(shell, from, dir, cache)
	var d_deck := W.ray_distance(deck, from, dir, cache)
	t.ok(d_deck < d_shell and d_shell < INF, "the deck (%.2f m) is nearer than the shell's far side (%.2f m)" % [d_deck, d_shell])
	t.ok(is_inf(W.ray_distance(deck, from, Vector3.UP, cache)), "a ray that misses")
	t.eq(cache.size(), 2, "one triangle mesh per mesh, built once")
	shell.free()
	deck.free()


## WO-1004 — the Layers rows sit in the Inspector's own scroll (WO-948): a head picked while the Programmer is on screen
## must not pull the column up to MVR scene → Layers. Only marks that changed, on rows already in view, scroll.
func test_highlight_leaves_the_inspector_where_it_is() -> void:
	var sc := ScrollContainer.new()
	sc.size = Vector2(300, 200)
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var v := VBoxContainer.new()
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var pad := func(h: float) -> Control:
		var c := Control.new()
		c.custom_minimum_size.y = h
		return c
	var rows := ColorRows.new()
	var names := range(30).map(func(i: int) -> String: return "L%d" % i)
	rows.fill(names, {})
	v.add_child(pad.call(1000.0))
	v.add_child(rows)
	v.add_child(pad.call(2000.0))  # the Programmer, further down
	sc.add_child(v)
	t.root.add_child(sc)
	await t.process_frame
	await t.process_frame
	var bottom := int(v.size.y - sc.size.y)
	sc.scroll_vertical = bottom
	await t.process_frame
	rows.highlight(["L25"])
	await t.process_frame
	await t.process_frame
	t.eq(sc.scroll_vertical, bottom, "rows off screen: the Programmer stays in view")
	sc.scroll_vertical = int(rows.position.y)
	await t.process_frame
	rows.highlight(["L26"])
	await t.process_frame
	await t.process_frame
	t.ok(sc.scroll_vertical > int(rows.position.y), "rows on screen: the marked row is scrolled into view (WO-647)")
	var at := sc.scroll_vertical
	sc.scroll_vertical = int(rows.position.y)
	await t.process_frame
	rows.highlight(["L26"])
	await t.process_frame
	await t.process_frame
	t.eq(sc.scroll_vertical, int(rows.position.y), "the same marks again (a project reload) do not scroll (was %d)" % at)
	sc.queue_free()
