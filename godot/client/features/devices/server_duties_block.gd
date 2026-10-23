extends VBoxContainer
## WO-712 R1 — "This server does": tick boxes for what THIS server does (server src/cluster/server-duties.js,
## GET / POST /api/server/duties, WS `server:duties`). Device-local like the cables: each server's own Devices view sets
## its own ticks; linked servers' ticks are shown read-only on their cards (cluster_panel.gd, ClusterModel.does_text).
## Every tick defaults to on, so a single box does everything. Each tick gates its own tick on the server (detection
## sidecar, zone actions, Auto director, DMX / PSN, VISCA, presenter intake).

const M := preload("res://features/devices/cluster_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _boxes := {}  # duty name → CheckBox
var _status: Label


func _ready() -> void:
	add_theme_constant_override("separation", 2)
	var head := Label.new()
	head.text = "THIS SERVER DOES"
	head.add_theme_font_size_override("font_size", 12)
	head.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(head)
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 0)
	add_child(grid)
	for d in M.DUTIES:
		var b := CheckBox.new()
		b.text = str(d.label)
		b.tooltip_text = str(d.tip)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.set_pressed_no_signal(true)
		b.toggled.connect(func(on: bool) -> void: _save(str(d.id), on))
		grid.add_child(b)
		_boxes[str(d.id)] = b
	_status = Label.new()
	_status.add_theme_font_size_override("font_size", 12)
	_status.add_theme_color_override("font_color", ThemeBuilder.ERROR)
	_status.visible = false
	add_child(_status)
	Ws.on("server:duties", func(d: Variant) -> void: _show(d))
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			reload())
	if is_visible_in_tree():
		reload()


func reload() -> void:
	var r: Dictionary = await Api.get_json("/api/server/duties")
	if r.ok:
		_show(r.data)


func _show(d: Variant) -> void:
	if not d is Dictionary:
		return
	for id in _boxes:
		if d.has(id):
			(_boxes[id] as CheckBox).set_pressed_no_signal(d[id] == true)


func _save(id: String, on: bool) -> void:
	var r: Dictionary = await Api.post_json("/api/server/duties", {"patch": {id: on}})
	_status.visible = not r.ok
	if r.ok:
		_show(r.data)
	else:
		var d: Variant = r.get("data")
		_status.text = "Not saved: " + (str(d.get("error", "")) if d is Dictionary else str(r.get("error", "")))
		reload()  # snap the box back to what the server holds
