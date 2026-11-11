extends VBoxContainer
## WO-1039 — the PixelHue main tab (after Devices; shown only while the switcher set in Devices ▸ PixelHue answers):
## the owner's PixelHue Studio as native panels — Device, Inputs, Outputs, Screens, Programming, MVR, Audio — over the
## Studio engine the server runs (studio_api.gd). Each sub-tab is one panel script in this folder: a Control with
## `func refresh() -> void` (called when its tab is shown and by the header's Refresh) and an optional
## `signal status(text: String)` shown in the header.
## Launch argument `--pixelhue-tab=<sub-tab>` (Device, Inputs, …) opens the client on that sub-tab once the switcher
## answers — for looking at a panel without touching the pointer.

signal available_changed(on: bool)

const StudioApi := preload("res://features/pixelhue/studio_api.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
## [title, script, capability the switcher must report ("" = always)]
const PANELS := [
	["Device", "res://features/pixelhue/device_panel.gd", ""],
	["Inputs", "res://features/pixelhue/inputs_panel.gd", "inputs"],
	["Outputs", "res://features/pixelhue/outputs_panel.gd", ""],
	["Screens", "res://features/pixelhue/screens_panel.gd", ""],
	["Programming", "res://features/pixelhue/programming_panel.gd", ""],
	["MVR", "res://features/pixelhue/mvr_panel.gd", "mvr"],
	["Audio", "res://features/pixelhue/audio_panel.gd", "audio"],
]
const POLL_S := 5.0

var _tabs: TabContainer
var _device: Label
var _note: Label
var _available := false
var _caps := {}


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 12)
	_device = Label.new()
	head.add_child(_device)
	_note = Label.new()
	_note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_note.clip_text = true
	_note.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	head.add_child(_note)
	var refresh := Button.new()
	refresh.text = "Refresh"
	refresh.tooltip_text = "Read this page again from the switcher"
	refresh.pressed.connect(_refresh_current)
	head.add_child(refresh)
	add_child(head)
	_tabs = TabContainer.new()
	_tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(_tabs)
	for p in PANELS:
		var script: GDScript = load(p[1]) if ResourceLoader.exists(p[1]) else null
		var page: Control = script.new() if script != null and script.can_instantiate() else _missing(str(p[0]))
		page.name = str(p[0])
		page.set_meta("capability", str(p[2]))
		if page.has_signal("status"):
			page.connect("status", func(text: String) -> void: _note.text = text)
		_tabs.add_child(page)
	_tabs.tab_changed.connect(func(_i: int) -> void: _refresh_current())
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			_refresh_current())
	var t := Timer.new()
	t.wait_time = POLL_S
	t.autostart = true
	t.timeout.connect(_poll)
	add_child(t)
	_poll.call_deferred()


func _missing(title: String) -> Control:
	var l := Label.new()
	l.text = "%s is not available in this build." % title
	return l


## Is a switcher there? Asked of the server every POLL_S (the tab strip hides this tab otherwise).
func _poll() -> void:
	var r: Dictionary = await Api.get_json(StudioApi.BASE + "status")
	var d: Dictionary = r.data if r.ok and r.data is Dictionary else {}
	var on: bool = d.get("connected") == true
	var dev: Dictionary = d.get("device", {}) if d.get("device") is Dictionary else {}
	_device.text = "%s · %s · %s" % [str(dev.get("model", "PixelHue")), str(dev.get("host", "")), str(dev.get("serial", ""))] if on else "PixelHue: not connected"
	var caps: Dictionary = d.get("capabilities", {}) if d.get("capabilities") is Dictionary else {}
	if on and caps != _caps:
		_caps = caps
		for i in _tabs.get_tab_count():
			var cap := str(_tabs.get_tab_control(i).get_meta("capability", ""))
			_tabs.set_tab_hidden(i, cap != "" and caps.get(cap) != true)
	if on != _available:
		_available = on
		if on and Config.args.has("pixelhue-tab"):  # launch argument --pixelhue-tab=<sub-tab title>, e.g. Programming
			for i in _tabs.get_tab_count():
				if _tabs.get_tab_control(i).name.to_lower() == str(Config.args["pixelhue-tab"]).to_lower():
					_tabs.current_tab = i
		available_changed.emit(on)
		if on and is_visible_in_tree():
			_refresh_current()


func _refresh_current() -> void:
	if not _available or not is_visible_in_tree():
		return
	var page := _tabs.get_current_tab_control()
	if page != null and page.has_method("refresh"):
		_note.text = ""
		page.call("refresh")
