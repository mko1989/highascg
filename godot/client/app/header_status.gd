extends HBoxContainer
## WO-608 header — the web header right group (header-bar.js statusEl + app-pgm-header-timer.js +
## header-bar-audio.js): PGM now-playing timer with one chip per screen, the wall clock (owner todos27, placement 4:
## timer → clock → eyes) and the server headphone-monitor menu.
## The web menu's upper half picks which browser preview stream you hear; the Godot client plays no stream audio,
## so only the server half (POST /api/audio/monitor-source) is here, and the button hides when the box has no
## monitor / preview bus.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const HeaderModel := preload("res://app/header_model.gd")
const M := preload("res://app/header_badges_model.gd")
const TimerView := preload("res://features/live/pgm_timer_view.gd")
const UiIcons := preload("res://app/ui_icons.gd")

const UI_CFG := "user://ui.cfg"

signal notice(n: Dictionary)

var clock: Label
var timer: TimerView
var chips: HBoxContainer
var audio_btn: Button
var _audio_menu: PopupMenu
var _audio_ids: Array = []
var _tick: Timer
var _main := 0


func _ready() -> void:
	add_theme_constant_override("separation", 10)
	chips = HBoxContainer.new()
	chips.add_theme_constant_override("separation", 2)
	add_child(chips)
	timer = TimerView.new()
	timer.custom_minimum_size.x = 360
	add_child(timer)
	clock = Label.new()
	clock.add_theme_font_size_override("font_size", 15)
	clock.tooltip_text = "Wall clock (this computer)"
	add_child(clock)
	audio_btn = UiIcons.button("headphones", "Monitor audio — the server's headphone bus")
	audio_btn.flat = true
	audio_btn.pressed.connect(_open_audio)
	add_child(audio_btn)
	_audio_menu = PopupMenu.new()
	_audio_menu.id_pressed.connect(_pick_audio)
	add_child(_audio_menu)
	_tick = Timer.new()
	_tick.wait_time = 1.0
	_tick.timeout.connect(_update_clock)
	add_child(_tick)
	_tick.start()
	_update_clock()
	var cfg := ConfigFile.new()
	if cfg.load(UI_CFG) == OK:
		_main = int(cfg.get_value("header", "timer_main", 0))
	Store.changed.connect(func(p: String, _v: Variant) -> void:
		if p == "channelMap" or p == "*" or p == "":
			_render_chips())
	_render_chips()


## The OSC mirror exists after the header (shell builds it next) — the timer follows it from here on.
func setup(osc_mirror: Node) -> void:
	timer.setup(osc_mirror, _main)
	timer.refresh()


func _cm() -> Dictionary:
	return Store.get_value("channelMap", {}) if Store.get_value("channelMap") is Dictionary else {}


func _render_chips() -> void:
	var list := M.timer_chips(_cm())
	if _main >= list.size():
		_main = 0
	for c in chips.get_children():
		c.queue_free()
	if list.size() > 1:  # one screen: nothing to choose
		for chip in list:
			var b := Button.new()
			b.text = str(chip.label)
			b.tooltip_text = str(chip.tip)
			b.toggle_mode = true
			b.button_pressed = int(chip.main) == _main
			b.focus_mode = Control.FOCUS_NONE
			b.add_theme_font_size_override("font_size", 11)
			b.pressed.connect(_choose.bind(int(chip.main)))
			chips.add_child(b)
	timer.main = _main
	timer.refresh()
	audio_btn.visible = not (M.monitor_options(_cm()).options as Array).is_empty()


func _choose(main: int) -> void:
	_main = main
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	cfg.set_value("header", "timer_main", main)
	cfg.save(UI_CFG)
	_render_chips()


func _update_clock() -> void:
	clock.text = HeaderModel.clock_text(Time.get_time_dict_from_system())


func _open_audio() -> void:
	var m := M.monitor_options(_cm())
	_audio_menu.clear()
	_audio_ids = []
	_audio_menu.add_separator(str(m.title))
	for o in m.options:
		_audio_menu.add_item(str(o.label), _audio_ids.size())
		_audio_ids.append(str(o.id))
	if str(m.note) != "":
		_audio_menu.add_separator(str(m.note))
	_audio_menu.position = Vector2i(audio_btn.global_position + Vector2(0, audio_btn.size.y))  # embedded popups: window coords
	_audio_menu.reset_size()
	_audio_menu.popup()


func _pick_audio(id: int) -> void:
	if id < 0 or id >= _audio_ids.size():
		return
	var res: Dictionary = await Api.post_json("/api/audio/monitor-source", {"source": _audio_ids[id]})
	if not res.ok:
		notice.emit({"text": "Monitor source: " + str(res.error), "tone": "error"})
