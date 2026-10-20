extends VBoxContainer
## WO-608 — Settings → Live audio (web settings-live-audio-panel.js): status of the live-audio host channels,
## capture device per configured slot, PGM routing defaults, headphones / solo preview bus, Save (config + apply),
## Apply PLAY + PGM routes; the ALSA mixer below. Slots are added / removed in Sources → Live → + and the Audio tab.

const K := preload("res://features/settings/pane_kit.gd")
const M := preload("res://features/settings/live_audio_model.gd")
const S := preload("res://features/devices/input_slots_model.gd")
const AlsaMixer := preload("res://features/settings/alsa_mixer_panel.gd")

var _status: VBoxContainer
var _slots: GridContainer
var _slot_pickers: Array = []
var _always: CheckBox
var _pgm_screen: SpinBox
var _pgm_layer: SpinBox
var _audio_only: CheckBox
var _pv_on: CheckBox
var _pv_bus: OptionButton
var _pv_screen: SpinBox
var _pv_device: OptionButton
var _pv_default: OptionButton
var _action: Label
var _devices: Array = []
var _mixer: VBoxContainer


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	K.heading(self, "Live audio (ALSA / USB)")
	K.note(self, "Capture devices and PGM routing defaults. To add live audio inputs use Sources → Live → + or the "
		+ "Audio tab; remove them in the Audio tab.")
	_status = VBoxContainer.new()
	add_child(_status)
	_slots = K.grid(self)
	K.heading(self, "PGM routing (always-on)").add_theme_font_size_override("font_size", 15)
	_always = _check("Route live inputs to program after connect")
	var g := K.grid(self)
	_pgm_screen = _spin(g, "Screen", 1, 4)
	_pgm_layer = _spin(g, "First PGM layer", 1, 99)
	_audio_only = _check("Audio only on PGM routes (opacity 0)")
	K.heading(self, "Headphones / solo (audio preview)").add_theme_font_size_override("font_size", 15)
	K.note(self, "Uses <system-audio> on preview or multiview — not the legacy PortAudio monitor channel.")
	_pv_on = _check("Enable audio preview bus")
	var g2 := K.grid(self)
	_pv_bus = _option(g2, "Preview bus", M.BUSES)
	_pv_screen = _spin(g2, "Preview screen index", 1, 4)
	_pv_device = _option(g2, "OpenAL device (optional)", [["", "Default sink"]])
	_pv_default = _option(g2, "When solo cleared", M.DEFAULT_SOURCES)
	var r := K.row(self)
	K.button(r, "Refresh devices", func() -> void:
		_action.text = "Refreshing capture devices…"
		await _load_devices(true)
		_fill_from_settings()
		_action.text = "Device list updated.")
	K.button(r, "Save config", _save)
	K.button(r, "Apply PLAY + PGM routes", _apply)
	_action = K.note(self, "")
	K.note(self, "Device-only changes: save here (capture is re-applied on the existing host channels). A slot-count "
		+ "change needs the Caspar config regenerated in Devices and a restart.")
	_mixer = AlsaMixer.new()
	add_child(_mixer)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			refresh())


func refresh() -> void:
	await _load_devices(false)
	_fill_from_settings()
	await _load_status()
	_mixer.load_mixer(false)


func _load_devices(refresh: bool) -> void:
	var r: Dictionary = await Api.get_json("/api/audio/devices" + ("?refresh=1" if refresh else ""))
	_devices = r.data.get("devices", []) if r.ok and r.data is Dictionary and r.data.get("devices") is Array else []


func _load_status() -> void:
	var r: Dictionary = await Api.get_json("/api/audio/live-inputs")
	for c in _status.get_children():
		c.queue_free()
	for line in (M.status_lines(r.data) if r.ok and r.data is Dictionary else [[str(r.error), "warn"]]):
		var l := K.note(_status, line[0])
		if line[1] == "warn":
			l.add_theme_color_override("font_color", Color("#f87171"))
		elif line[1] == "ok":
			l.add_theme_color_override("font_color", Color("#86efac"))


func _ui() -> Dictionary:
	return S.read_live_audio(Settings.get_setting("casparServer", {}))


func _fill_from_settings() -> void:
	var ui := _ui()
	for c in _slots.get_children():
		c.queue_free()
	_slot_pickers.clear()
	var opts := S.alsa_options(_devices)
	for i in range(ui.count):
		var cur: String = ui.slots[i]
		var items := opts.duplicate()
		if cur != "" and not items.any(func(o: Array) -> bool: return o[0] == cur):
			items.append([cur, "%s (saved)" % cur])
		_slot_pickers.append(_option(_slots, "Slot %d — capture device" % (i + 1), items, cur))
	_always.button_pressed = ui.pgmAlwaysOn
	_pgm_screen.value = ui.pgmScreen
	_pgm_layer.value = ui.pgmLayer
	_audio_only.button_pressed = ui.pgmAudioOnly
	_pv_on.button_pressed = ui.audioPreviewEnabled
	_select(_pv_bus, ui.audioPreviewBus)
	_pv_screen.value = ui.audioPreviewScreen
	_pv_device.clear()
	for o in M.preview_devices(_devices):
		_pv_device.add_item(o[1])
		_pv_device.set_item_metadata(_pv_device.item_count - 1, o[0])
	_select(_pv_device, ui.audioPreviewDevice)
	_select(_pv_default, ui.audioPreviewDefaultSource)


func _save() -> void:
	var ui := _ui()
	for i in _slot_pickers.size():
		var ob: OptionButton = _slot_pickers[i]
		if ob.selected >= 0:
			ui.slots[i] = str(ob.get_item_metadata(ob.selected))
	ui.pgmAlwaysOn = _always.button_pressed
	ui.pgmScreen = int(_pgm_screen.value)
	ui.pgmLayer = int(_pgm_layer.value)
	ui.pgmAudioOnly = _audio_only.button_pressed
	ui.audioPreviewEnabled = _pv_on.button_pressed
	ui.audioPreviewBus = _meta(_pv_bus)
	ui.audioPreviewScreen = int(_pv_screen.value)
	ui.audioPreviewDevice = _meta(_pv_device)
	ui.audioPreviewDefaultSource = _meta(_pv_default)
	if ui.count > 0:
		ui.hostChannelEnabled = true
	_action.text = "Saving…"
	var r: Dictionary = await Api.post_json("/api/audio/live-inputs/config", S.live_audio_body(ui))
	if not r.ok:
		_action.text = "Save failed: %s" % str(r.error)
		return
	await Settings.load_from_server()
	await Api.post_json("/api/audio/live-inputs/apply", {})  # the host channel may not exist before the first apply
	await _load_status()
	_action.text = "Saved. Capture re-applied on existing host channel(s)."


func _apply() -> void:
	_action.text = "Applying routes…"
	var r: Dictionary = await Api.post_json("/api/audio/live-inputs/apply", {})
	await _load_status()
	_action.text = "PLAY + PGM routes sent (requires AMCP connected)." if r.ok else "Apply failed: %s" % str(r.error)


func _check(text: String) -> CheckBox:
	var c := CheckBox.new()
	c.text = text
	c.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	add_child(c)
	return c


func _spin(grid: GridContainer, label: String, lo: int, hi: int) -> SpinBox:
	var l := Label.new()
	l.text = label
	grid.add_child(l)
	var sb := SpinBox.new()
	sb.min_value = lo
	sb.max_value = hi
	sb.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	grid.add_child(sb)
	return sb


func _option(grid: GridContainer, label: String, items: Array, cur := "") -> OptionButton:
	var l := Label.new()
	l.text = label
	grid.add_child(l)
	var ob := OptionButton.new()
	for o in items:
		ob.add_item(o[1])
		ob.set_item_metadata(ob.item_count - 1, o[0])
	_select(ob, cur)
	ob.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	grid.add_child(ob)
	return ob


func _select(ob: OptionButton, value: String) -> void:
	for i in ob.item_count:
		if str(ob.get_item_metadata(i)) == value:
			ob.select(i)
			return


func _meta(ob: OptionButton) -> String:
	return str(ob.get_item_metadata(ob.selected)) if ob.selected >= 0 else ""
