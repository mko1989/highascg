extends RefCounted
## WO-605 slice 3 — the destination inspector page against the web's renderDestinationInspector, run under Node
## on a fake DOM over six destinations (PGM/PRV, custom PGM-only, project-fps inherit, pixel map, operator GUI,
## multiview): tests/golden/devices_destination_form.json. Drives the real page — fills a field, submits it and
## captures the `patch` signal — so math-input correction, clamping and the patch builders are all in the loop.

const Page := preload("res://features/devices/destination_inspector.gd")
const DM := preload("res://features/devices/destinations_model.gd")
const MI := preload("res://core/math_input.gd")
const SETTINGS := {"machineProfile": {"defaultProjectFps": 25}}
var t
var _g: Dictionary


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_destination_form.json"))
	return _g


static func _norm(v: Variant) -> Variant:
	if v is int:
		return float(v)
	if v is Dictionary:
		var o := {}
		for k in v:
			o[k] = _norm(v[k])
		return o
	if v is Array:
		return v.map(func(x: Variant) -> Variant: return _norm(x))
	return v


func _page(c: Dictionary, calls: Array) -> Page:
	var d: Dictionary = c.d
	var entry := {"id": d.id, "label": d.get("label", d.id), "mode": d.get("mode", "pgm_prv"), "host": false,
		"connector": "", "dest": d, "intent": c.intent}
	var p := Page.new()
	p.patch.connect(func(id: String, body: Dictionary) -> void: calls.append({"id": id, "patch": body}))
	p.show_destination(entry, {}, SETTINGS)
	return p


func _controls(n: Node, out: Array = []) -> Array:
	for c in n.get_children():
		if c is LineEdit or c is OptionButton or c is CheckBox:
			out.append(c)
		else:
			_controls(c, out)
	return out


func _field(c: Control) -> Array:
	if c is LineEdit:
		return [c.text, not c.editable]
	if c is OptionButton:
		return ["SEL:" + str(c.get_selected_metadata()), false]
	return ["", false]


## The web harness's finders (placeholder / title / option value) over the Godot controls.
func _find(ctrls: Array, action: String) -> Control:
	var by_ph := {"width": "Width", "height": "Height", "fps": "Frame rate", "name": "Name", "artnet ip": "192.168.1.50"}
	var by_tip := {"main index": "Main index (zero-based)", "artnet cols": "Fixture columns", "artnet rows": "Fixture rows",
		"artnet fixture type": "Fixture type (fixture/type)", "artnet start universe": "Start Art-Net universe",
		"artnet start DMX channel": "Start DMX channel", "artnet DMX sends/sec": "DMX sends/sec"}
	var by_opt := {"video mode": "1080p5000", "mode": "operator_gui", "audio layout": "8ch", "physical port": "3", "video output": "shm"}
	var key := action.split(" -> ")[0]
	for c in ctrls:
		if by_ph.has(key) and c is LineEdit and c.placeholder_text.begins_with(by_ph[key]):
			return c
		if by_tip.has(key) and c.tooltip_text.begins_with(by_tip[key]):
			return c
		if by_opt.has(key) and c is OptionButton and _opt(c, by_opt[key]) >= 0:
			return c
	return null


static func _opt(ob: OptionButton, value: String) -> int:
	for i in ob.item_count:
		if str(ob.get_item_metadata(i)) == value:
			return i
	return -1


## What the harness typed for each action (form_golden.mjs ACTIONS).
const TYPED := {"width -> 1280": "1280", "height -> \"\"": "", "fps -> 29.97": "29.97", "name -> \"   \"": "   ",
	"main index -> -3": "-3", "artnet ip": " 10.0.0.9 ", "artnet cols": "0", "artnet rows": "abc",
	"artnet start universe": "40000", "artnet start DMX channel": "0", "artnet DMX sends/sec": ""}
const PICKED := {"video mode -> 1080p2500": "1080p2500", "video mode -> custom": "custom", "mode -> pgm_only": "pgm_only",
	"audio layout -> 8ch": "8ch", "artnet fixture type -> RGBW": "RGBW", "physical port -> auto": "", "physical port -> 3": "3",
	"video output -> shm": "shm"}


func test_summary_and_initial_fields() -> void:
	for c in _golden().cases:
		t.eq(_norm(DM.summary_rows(c.d, c.intent)), _norm(c.rows), "summary " + c.name)
		var p := _page(c, [])
		var got := _controls(p).map(_field)
		var want: Array = c.fields.map(func(f: Dictionary) -> Array:
			return [("SEL:" if f.tag == "select" else "") + str(f.value), f.disabled])
		t.eq(got, want, "fields " + c.name)
		p.free()


func test_actions_send_the_web_patches() -> void:
	var n := 0
	for c in _golden().cases:
		for a in c.actions:
			var name: String = a[0]
			var calls := []
			var p := _page(c, calls)
			var ctrl := _find(_controls(p), name)
			t.ok(ctrl != null, "control for %s / %s" % [c.name, name])
			if ctrl == null:
				p.free()
				continue
			var before := ""
			if ctrl is LineEdit:
				before = ctrl.text
				ctrl.text = TYPED[name]
				ctrl.text_submitted.emit(ctrl.text)
			elif ctrl is OptionButton:
				var i := _opt(ctrl, PICKED[name])
				ctrl.select(i)
				ctrl.item_selected.emit(i)
			else:
				ctrl.toggled.emit(false)
			if calls.is_empty() and ctrl is LineEdit:
				# Godot skips a commit whose corrected text is unchanged (the web re-sends the same value).
				t.eq(ctrl.text, before, "skipped only when unchanged: %s / %s" % [c.name, name])
			else:
				t.eq(_norm(calls), _norm(a[1]), "patch %s / %s" % [c.name, name])
				n += 1
			p.free()
	# WO-646: the kiosk's Web-UI URL and auto-launch actions left the golden (51 → 49).
	t.ok(n >= 48, "most actions produce a patch (%d)" % n)


func test_math_corrections_show_in_the_field() -> void:
	var c: Dictionary = _golden().cases[3]  # pixelmap
	for row in [["artnet cols", "0", "1"], ["artnet rows", "abc", "3"], ["artnet start universe", "40000", "32767"],
			["artnet DMX sends/sec", "", "30"], ["width -> 1280", "1920/2", "960"], ["fps -> 29.97", "abc", "50.00"],
			["fps -> 29.97", "30000/1001", "29.97"]]:
		var p := _page(c, [])
		var le: LineEdit = _find(_controls(p), row[0])
		le.text = row[1]
		le.text_submitted.emit(le.text)
		t.eq(le.text, row[2], "%s typed %s" % [row[0], row[1]])
		p.free()


func test_video_mode_preset_fills_size_fields() -> void:
	var c: Dictionary = _golden().cases[1]  # custom 2048x858p24
	var calls := []
	var p := _page(c, calls)
	var ctrls := _controls(p)
	var vm: OptionButton = _find(ctrls, "video mode")
	var i := _opt(vm, "720p5994")
	vm.select(i)
	vm.item_selected.emit(i)
	t.eq([_find(ctrls, "width").text, _find(ctrls, "height").text, _find(ctrls, "fps").text], ["1280", "720", "59.94"], "preset text")
	t.eq(_find(ctrls, "width").editable, false, "preset locks size")
	# A preset value is the new last-good: blanking width restores 1280, and that is no change → no patch.
	var w: LineEdit = _find(ctrls, "width")
	w.editable = true
	w.text = ""
	w.text_submitted.emit("")
	t.eq([w.text, calls.size()], ["1280", 1], "blank after preset restores preset, no extra patch")
	p.free()


## WO-639: picking Custom on a 1920x1080@50 screen posts custom 1920x1080@50, which the server files back as
## 1080p5000 (WO-486). The rebuild after that reload must keep Custom picked and the size fields open.
func test_custom_survives_the_reload() -> void:
	var c: Dictionary = _golden().cases[0]  # pgm_prv 1080p5000
	var calls := []
	var p := _page(c, calls)
	var vm: OptionButton = _find(_controls(p), "video mode")
	var i := _opt(vm, "custom")
	vm.select(i)
	vm.item_selected.emit(i)
	t.eq(calls.size(), 1, "custom posts once")
	var entry := {"id": c.d.id, "label": c.d.id, "mode": "pgm_prv", "host": false, "connector": "", "dest": c.d,
		"intent": c.intent}
	p.show_destination(entry, {}, SETTINGS)  # the reload: the record still says 1080p5000
	var ctrls := _controls(p)
	t.eq(str(_find(ctrls, "video mode").get_selected_metadata()), "custom", "Custom still picked")
	t.eq(_find(ctrls, "width").editable, true, "size open")
	vm = _find(ctrls, "video mode")
	i = _opt(vm, "1080p2500")
	vm.select(i)
	vm.item_selected.emit(i)
	p.show_destination(entry, {}, SETTINGS)
	t.eq(str(_find(_controls(p), "video mode").get_selected_metadata()), "1080p5000", "a real mode ends it")
	var other := entry.duplicate()
	other.id = "other"
	p.show_destination(entry, {}, SETTINGS)
	vm = _find(_controls(p), "video mode")
	vm.select(_opt(vm, "custom"))
	vm.item_selected.emit(_opt(vm, "custom"))
	p.show_destination(other, {}, SETTINGS)
	p.show_destination(entry, {}, SETTINGS)
	t.eq(str(_find(_controls(p), "video mode").get_selected_metadata()), "1080p5000", "another destination ends it")
	p.free()
