extends RefCounted
## WO-959 — one tick button for Test card / Border (tick = switch, label = options), the Border tick's slot helpers,
## and the "Screens" caption counting hidden screens that a look-preset save would still cover.

const TickButton := preload("res://app/tick_button.gd")
const BorderSwitch := preload("res://features/live/border_switch.gd")
const ScreensMenu := preload("res://features/live/screens_menu.gd")
const H := preload("res://features/live/deck_hidden.gd")
const Destinations := preload("res://features/live/destinations.gd")
const CFG := "user://test_wo959_tick_screens.cfg"
var t


func test_tick_button_splits_switch_and_options() -> void:
	var b := TickButton.new("Border", "on / off", "options")
	var got := {"toggled": [], "opened": 0}
	b.toggled.connect(func(on: bool) -> void: got.toggled.append(on))
	b.opened.connect(func() -> void: got.opened += 1)
	t.eq(b.label.text, "Border ▾", "the label names it and opens its options")
	b.label.pressed.emit()
	t.eq(got.opened, 1, "a click on the label opens the options")
	t.eq(got.toggled, [], "…and never switches it")
	b.tick.button_pressed = true
	t.eq(got.toggled, [true], "the tick switches it")
	t.eq(got.opened, 1, "…and opens nothing")
	b.set_on(false)
	t.eq(got.toggled, [true], "set_on (server state) sends no signal")
	t.ok(not b.is_on(), "set_on applied")
	b.free()


func test_border_slot_helpers() -> void:
	var p := {}
	t.ok(not BorderSwitch.enabled_in(p, 1), "no scenes → off")
	BorderSwitch.adopt(p, 1, {"enabled": true, "type": "border"})
	t.eq((p.scenes.globalBorders as Array).size(), 4, "four slots, like the server")
	t.ok(BorderSwitch.enabled_in(p, 1), "screen 2 on")
	t.ok(not BorderSwitch.enabled_in(p, 0), "screen 1 untouched")
	BorderSwitch.adopt(p, 1, {"enabled": false})
	t.ok(not BorderSwitch.enabled_in(p, 1), "switched off")
	t.eq(BorderSwitch.slot_of(p, 9), null, "out of range → no slot")


func test_screens_caption_counts_hidden_destinations() -> void:
	var was: String = H.cfg_path
	H.cfg_path = CFG
	DirAccess.remove_absolute(ProjectSettings.globalize_path(CFG))
	H.reset()
	Destinations.set_only([])
	t.eq(ScreensMenu.caption(3), "Screens", "nothing hidden")
	H.set_hidden(2, true)
	t.eq(ScreensMenu.caption(3), "Screens · 1 hidden", "one hidden")
	Destinations.toggle(2)
	t.eq(Destinations.selected(), [2], "a hidden screen can be highlighted")
	t.eq(ScreensMenu.caption(3), "Screens · 1 hidden, 1 selected", "the caption says a preset save covers it")
	H.show_all()
	Destinations.set_only([])
	DirAccess.remove_absolute(ProjectSettings.globalize_path(CFG))
	H.cfg_path = was
	H.reset()
