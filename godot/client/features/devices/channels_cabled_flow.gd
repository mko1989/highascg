extends VBoxContainer
## WO-1029 plan 07 (C12) — the per-server switch "Channels only for the screens cabled here" (one under this server's
## row and one on each linked server's card, through the relay). Turning it ON/OFF first asks the server for the dry
## run and shows it (channels_cabled_model.gd) in a confirm; only OK writes. The switch changes the plan, never Caspar:
## the Apply button turns amber by itself (the plan poll) and restarts Caspar.

const M := preload("res://features/devices/channels_cabled_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Kit := preload("res://features/settings/pane_kit.gd")

## WO-1106 C33: where the switch reads and writes. Defaults to DevicesTarget.api (this box, or the server the Devices
## tab edits); tests set a Callable returning a fake. `_api` is pinned when the state is read: a write goes to the
## server whose state the switch shows, and the switch on this server's row reads again when the edited server changes.
var target_api: Callable
var _api: Object = null
var _peer_id := ""
var _name := ""
var _box: CheckBox
var _status: Label


## Builds the switch into `parent` for this server (peer_id "") or a linked one.
static func attach(parent: Node, peer_id := "", server_name := "") -> void:
	var f := new()
	f._peer_id = peer_id
	f._name = server_name
	parent.add_child(f)


func _ready() -> void:
	_box = CheckBox.new()
	_box.text = M.SWITCH_TEXT
	_box.tooltip_text = M.SWITCH_TIP + M.SWITCH_TIP_2
	_box.disabled = true
	_box.toggled.connect(_toggled)
	add_child(_box)
	_status = Label.new()
	_status.add_theme_font_size_override("font_size", 12)
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_status)
	var dt := get_node_or_null("/root/DevicesTarget")
	if _peer_id == "" and dt != null:
		dt.connect("target_changed", _load)
	_load()


func _target() -> Object:
	if target_api.is_valid():
		return target_api.call()
	var dt := get_node_or_null("/root/DevicesTarget")
	return dt.get("api") if dt != null else null


func _load() -> void:
	var api := _target()
	_api = api
	_box.disabled = true
	if api == null:
		return
	var r: Dictionary = await api.get_json(M.endpoint(_peer_id))
	if not is_instance_valid(self) or api != _api:
		return
	var on: Variant = M.is_on(r.data) if r.ok else null
	_box.disabled = on == null
	_box.set_pressed_no_signal(on == true)
	_status.text = M.state_line(r.data) if r.ok else "Not available: %s" % str(r.get("error", ""))


func _toggled(enable: bool) -> void:
	_box.set_pressed_no_signal(not enable)
	var api := _api
	if api == null:
		return
	var r: Dictionary = await api.post_json(M.endpoint(_peer_id), {"enable": enable, "dryRun": true})
	if not is_instance_valid(self) or api != _api:
		return
	var plan: Dictionary = r.data.get("plan", {}) if r.ok and r.data is Dictionary and r.data.get("plan") is Dictionary else {}
	if plan.is_empty():
		_status.text = M.result_line(r)
		return
	var text := M.confirm_text(plan, _name)
	if M.blocked(plan):
		_status.text = "Cannot switch yet."
		Kit.confirm(self, text, func() -> void: pass)
		return
	var force := M.forceable(plan)
	var d := ConfirmationDialog.new()
	d.dialog_text = text
	d.title = M.SWITCH_TEXT
	d.ok_button_text = "Switch anyway" if force else "Switch"
	d.min_size = Vector2i(560, 0)
	d.confirmed.connect(func() -> void: _apply(api, enable, force))
	d.visibility_changed.connect(func() -> void:
		if not d.visible:
			d.queue_free())
	add_child(d)
	d.popup_centered()
	d.get_cancel_button().grab_focus.call_deferred()


func _apply(api: Object, enable: bool, force: bool) -> void:
	if api != _api:  # the edited server changed while the confirm was open: its state is not what the confirm showed
		_status.text = "Not switched: the server shown changed. Try again."
		return
	var r: Dictionary = await api.post_json(M.endpoint(_peer_id), {"enable": enable, "dryRun": false, "force": force})
	if not is_instance_valid(self) or api != _api:
		return
	_status.text = M.result_line(r)
	if r.ok:
		_box.set_pressed_no_signal(enable)
