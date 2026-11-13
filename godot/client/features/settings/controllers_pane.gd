extends VBoxContainer
## WO-1066 — Settings ▸ Controllers: pair Bluetooth game controllers for the game window (players 1–4, WO-1065).
## Scan (30 s), then Pair on the controller that shows up: the server pairs, trusts and connects it in one step
## (POST /api/bluetooth/pair). A paired controller reconnects by its own PS / Home button. A USB cable needs none of this.

const Kit := preload("res://features/settings/pane_kit.gd")
const M := preload("res://features/settings/controllers_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _status: Label
var _msg: Label
var _scan: Button
var _power: Button
var _list: VBoxContainer
var _busy := false
var _shown := ""


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	Kit.heading(self, "Game controllers")
	Kit.note(self, "Bluetooth gamepads for the games (Sources ▸ Games). Up to four play at once, in the order they connect. A controller on a USB cable works without pairing.")
	_status = Kit.note(self, "Loading…")
	var r := Kit.row(self)
	_scan = Kit.button(r, "Scan for controllers", _start_scan)
	_power = Kit.button(r, "Turn Bluetooth on", func() -> void: _post("power", {"on": true}, "Turning Bluetooth on…"))
	_power.visible = false
	_msg = Kit.note(self, "")
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 6)
	add_child(_list)
	var t := Timer.new()
	t.wait_time = 2.0
	t.autostart = true
	t.timeout.connect(func() -> void:
		if is_visible_in_tree() and not _busy:
			refresh())
	add_child(t)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			refresh())


func refresh() -> void:
	var r: Dictionary = await Api.get_json("/api/bluetooth")
	_render(r.data if r.ok and r.data is Dictionary else null)


func _render(d: Variant) -> void:
	_status.text = M.summary(d)
	var ok: bool = d is Dictionary and d.get("available") == true
	var on: bool = ok and d.get("powered") == true
	_power.visible = ok and not on
	_scan.disabled = not on or (d.get("scanning") == true)
	_scan.text = "Scanning…" if on and d.get("scanning") == true else "Scan for controllers"
	var devices: Array = d.get("devices", []) if ok else []
	var key := JSON.stringify(devices)
	if key == _shown:
		return  # same list: the buttons stay (a rebuild under the pointer eats the click)
	_shown = key
	for c in _list.get_children():
		c.queue_free()
	if on and devices.is_empty():
		Kit.note(_list, "No controller yet. Scan, then put the controller in pairing mode.")
	for dev in devices:
		if dev is Dictionary:
			_add_row(dev)


func _add_row(dev: Dictionary) -> void:
	var info: Dictionary = M.row(dev)
	var r := Kit.row(_list)
	var name := Label.new()
	name.text = str(dev.get("name", dev.get("address", "")))
	name.custom_minimum_size.x = 260
	name.tooltip_text = str(dev.get("address", ""))
	r.add_child(name)
	var st := Label.new()
	st.text = str(info.state)
	st.custom_minimum_size.x = 330
	st.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if dev.get("connected") == true else ThemeBuilder.TEXT_MUTED)
	r.add_child(st)
	for a in info.actions:
		var op := str(a[1])
		Kit.button(r, str(a[0]), func() -> void:
			_post(op, {"address": str(dev.get("address", ""))}, "%s: %s…" % [str(a[0]), name.text]))


func _start_scan() -> void:
	_post("scan", {"seconds": 30}, "")


func _post(op: String, body: Dictionary, busy: String) -> void:
	if _busy:
		return
	_busy = true
	_msg.text = busy
	var res: Dictionary = await Api.post_json("/api/bluetooth/" + op, body)
	_busy = false
	_msg.text = "" if res.ok else M.error_text(res)
	_shown = ""
	refresh()
