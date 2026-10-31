extends VBoxContainer
## WO-900 — the MIDI block of the Visuals Inspector page: which controller is plugged in and how many controls are mapped
## (the tooltip lists them), Learn (move a control, then click the slider or button it should drive), Unmap (move a control
## or click a target: its mapping goes), ⋯ (the APC40 mkII map, clear all, APC40 pad lights) and one line about the last
## control moved — "waiting: bring it to 45 %" while a fader has not picked its slider up. The page's sliders show the
## waiting control's position as an amber tick (midi_ghost.gd). Dumb: visuals_midi.gd drives it through set_state().

signal learn_toggled(on: bool)
signal unmap_toggled(on: bool)
signal menu_picked(id: int)

const MENU_APC := 0
const MENU_CLEAR := 1
const MENU_LEDS := 3

var ctl: Object  ## visuals_midi.gd — asked for the clicked target while Learn / Unmap waits for one
var learn: Button
var unmap: Button
var more: MenuButton
var _devices: Label
var _note: Label


func _init() -> void:
	add_theme_constant_override("separation", 4)
	_devices = Label.new()
	_devices.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_devices.mouse_filter = Control.MOUSE_FILTER_PASS  # its tooltip lists the mapping
	add_child(_devices)
	var row := HBoxContainer.new()
	learn = _toggle("Learn", "Learn: move a fader, knob or pad on the controller, then click the slider or button it should drive")
	learn.toggled.connect(func(on: bool) -> void: learn_toggled.emit(on))
	row.add_child(learn)
	unmap = _toggle("Unmap", "Unmap: move a control (or click a slider or button) — its MIDI mapping is removed")
	unmap.toggled.connect(func(on: bool) -> void: unmap_toggled.emit(on))
	row.add_child(unmap)
	more = MenuButton.new()
	more.text = "⋯"
	more.flat = false
	more.focus_mode = Control.FOCUS_NONE
	more.tooltip_text = "More: the APC40 mkII map, clear all, pad lights"
	var pm := more.get_popup()
	pm.add_item("Load the APC40 mkII map (replaces this mapping)", MENU_APC)
	pm.add_item("Clear all mappings", MENU_CLEAR)
	pm.add_separator()
	pm.add_check_item("APC40 pad lights (switches it to Ableton mode)", MENU_LEDS)
	pm.id_pressed.connect(func(id: int) -> void: menu_picked.emit(id))
	row.add_child(more)
	add_child(row)
	_note = Label.new()
	_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_note.modulate = Color(1, 1, 1, 0.7)
	add_child(_note)


func _toggle(text: String, tip: String) -> Button:
	var b := Button.new()
	b.text = text
	b.toggle_mode = true
	b.focus_mode = Control.FOCUS_NONE  # the show keys stay show keys
	b.tooltip_text = tip
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return b


## `mode` "", "learn" or "unmap" (the buttons' state); `waiting` tints the line amber (a control is not picked up yet).
func set_state(devices: String, map_tip: String, note: String, mode: String, leds: bool, waiting := false) -> void:
	_devices.text = devices
	_devices.tooltip_text = map_tip
	_note.text = note
	_note.visible = note != ""
	_note.modulate = Color(1.0, 0.8, 0.45, 0.95) if waiting else Color(1, 1, 1, 0.7)
	learn.set_pressed_no_signal(mode == "learn")
	unmap.set_pressed_no_signal(mode == "unmap")
	var pm := more.get_popup()
	pm.set_item_checked(pm.get_item_index(MENU_LEDS), leds)


func note_text() -> String:
	return _note.text


## While Learn / Unmap waits for a target, a left click on one of the page's sliders or buttons picks it (and goes no
## further: the slider does not jump, the look is not recalled).
func _input(event: InputEvent) -> void:
	var mb := event as InputEventMouseButton
	if mb == null or not mb.pressed or mb.button_index != MOUSE_BUTTON_LEFT or ctl == null or not ctl.wants_click():
		return
	if ctl.click_at(get_canvas_transform().affine_inverse() * mb.position):
		get_viewport().set_input_as_handled()
