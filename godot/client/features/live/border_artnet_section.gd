extends VBoxContainer
## WO-601 — global border "Lighting input (Art-Net/sACN)" (web inspector-global-border-artnet.js): listen opt-in,
## then a closed-by-default disclosure with protocol, start channel, universe, the 18-row DMX channel table (uncheck =
## that parameter stays under UI control) and "Save fixture file…". Config only — the server's receiver applies it.

signal edit(patch: Dictionary)

const A := preload("res://features/live/border_artnet_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const SenderPicker := preload("res://features/devices/sender_picker.gd")

static var _details_open := false  # web dmxDetailsOpen: survives re-renders, closed at load

var _dialog: FileDialog
var _picker: HBoxContainer  # WO-723: kept across re-renders (a desk re-renders this every 150 ms; one fetch, not one each)


func build(gb: Dictionary) -> void:
	for c in get_children():
		if c != _dialog and c != _picker:
			c.queue_free()
	var title := Label.new()
	title.text = "Lighting input (Art-Net/sACN)"
	add_child(title)
	var listen := CheckBox.new()
	listen.text = "Listen on this screen (opt-in — while off, only UI controls drive the border)"
	listen.button_pressed = gb.get("artnetListenEnabled") == true
	listen.toggled.connect(func(on: bool) -> void: edit.emit({"artnetListenEnabled": on}))
	add_child(listen)
	if _picker == null:
		_picker = SenderPicker.make("artnet_in", "Received by")  # only shown while servers are linked
		add_child(_picker)
	move_child(_picker, -1)
	var patch: Dictionary = gb.get("artnetPatch", {}) if gb.get("artnetPatch") is Dictionary else {}
	var start := int(patch.get("startChannel", 1)) if int(patch.get("startChannel", 1)) > 0 else 1
	var tog := Button.new()
	tog.flat = true
	tog.alignment = HORIZONTAL_ALIGNMENT_LEFT
	var body := VBoxContainer.new()
	body.visible = _details_open
	var summary := func() -> String:
		return "%s DMX patch & channel mapping (universe %d, start ch %d)" % ["▾" if body.visible else "▸", int(patch.get("universe", 0)), start]
	tog.text = summary.call()
	tog.pressed.connect(func() -> void:
		body.visible = not body.visible
		_details_open = body.visible
		tog.text = summary.call())
	add_child(tog)
	add_child(body)
	var g := GridContainer.new()
	g.columns = 2
	g.add_child(_cell("Protocol"))
	var proto := OptionButton.new()
	proto.add_item("Art-Net")
	proto.add_item("sACN (E1.31)")
	proto.select(1 if str(gb.get("lightingProtocol", "")) == "sacn" else 0)
	proto.item_selected.connect(func(i: int) -> void: edit.emit({"lightingProtocol": "sacn" if i == 1 else "artnet"}))
	g.add_child(proto)
	g.add_child(_cell("Start channel"))
	var sc := SpinBox.new()
	sc.min_value = 1
	sc.max_value = 512
	sc.value = start
	sc.value_changed.connect(func(v: float) -> void: edit.emit({"artnetPatch": {"startChannel": int(v)}}))
	g.add_child(sc)
	g.add_child(_cell("Universe"))
	var uni := SpinBox.new()
	uni.max_value = 16
	uni.value = int(patch.get("universe", 0))
	uni.value_changed.connect(func(v: float) -> void: edit.emit({"artnetPatch": {"universe": int(v)}}))
	g.add_child(uni)
	body.add_child(g)
	body.add_child(_muted("Uncheck a row to keep that parameter under UI control while Art-Net is on."))
	var map := A.normalize_map(gb.get("artnetChannelMap"))
	var t := GridContainer.new()
	t.columns = 3
	for h in ["Parameter", "DMX ch", "Desk"]:
		t.add_child(_cell(h))
	for i in A.COUNT:
		var l := Label.new()
		l.text = A.LABELS[i]
		t.add_child(l)
		var ch := Label.new()
		ch.text = str(start + i)
		t.add_child(ch)
		var cb := CheckBox.new()
		cb.button_pressed = map[i]
		var off := i
		cb.toggled.connect(func(on: bool) -> void:
			map[off] = on
			edit.emit({"artnetChannelMap": map.duplicate()}))
		t.add_child(cb)
	body.add_child(t)
	var dl := Button.new()
	dl.text = "Save fixture file…"
	dl.tooltip_text = "The lighting-desk fixture definition for this border (global-border.txt)"
	dl.pressed.connect(_save_fixture)
	body.add_child(dl)


func _save_fixture() -> void:
	if _dialog == null:
		_dialog = FileDialog.new()
		_dialog.file_mode = FileDialog.FILE_MODE_SAVE_FILE
		_dialog.access = FileDialog.ACCESS_FILESYSTEM
		_dialog.current_file = "global-border.txt"
		_dialog.file_selected.connect(func(p: String) -> void: save_fixture_to(p))
		add_child(_dialog)
	_dialog.popup_centered_ratio(0.6)


## GET the fixture text from the server and write it (also the probe entry point).
func save_fixture_to(path: String) -> bool:
	var r: Dictionary = await Api.get_json("/api/scene/global-border/fixture")
	if not r.ok or not (r.data is String):
		return false
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return false
	f.store_string(r.data)
	return true


## A grid label: no wrap (a wrapping label in a GridContainer collapses to one letter per line, owner 27.10).
func _cell(text: String) -> Label:
	var l := _muted(text)
	l.autowrap_mode = TextServer.AUTOWRAP_OFF
	l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return l


func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l
