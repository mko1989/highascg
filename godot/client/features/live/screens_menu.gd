extends Button
## WO-959 — the deck toolbar's "Screens" (was WO-953's check menu): one row per screen — its name highlights it as a
## look-preset destination (the same toggle as the column title, destinations.gd), the eye next to it shows / hides
## its deck column (deck_hidden.gd). A hidden screen stays selectable here, so a look preset can still cover it
## (owner 05.11: "i should still be able to select a hidden screen destination so it can be saved with a look preset").

const ThemeBuilder := preload("res://app/theme_builder.gd")
const Icons := preload("res://app/ui_icons.gd")
const DeckModel := preload("res://features/live/deck_model.gd")
const DeckHidden := preload("res://features/live/deck_hidden.gd")
const Destinations := preload("res://features/live/destinations.gd")

var popup: PopupPanel
var rows: VBoxContainer


func _ready() -> void:
	focus_mode = Control.FOCUS_NONE
	tooltip_text = "Screens: click one to make it a look-preset destination; its eye shows or hides its column in this deck (the preview above is unchanged)"
	popup = PopupPanel.new()
	popup.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, ThemeBuilder.BORDER, 1))
	rows = VBoxContainer.new()
	rows.add_theme_constant_override("separation", 4)
	popup.add_child(rows)
	add_child(popup)
	pressed.connect(_toggle)
	Store.changed.connect(func(path: String, _v: Variant) -> void:
		if path == "*" or path == "channelMap" or path == DeckHidden.PATH or path == Destinations.PATH:
			_label()
			if popup.visible:
				fill.call_deferred())  # deferred: the pressed row button is still emitting
	_label()


static func _cm() -> Dictionary:
	var tree := Engine.get_main_loop() as SceneTree
	var store: Node = tree.root.get_node_or_null("Store") if tree != null else null
	var v: Variant = store.get_value("channelMap", {}) if store != null else {}
	return v if v is Dictionary else {}


## "Screens", "Screens · 1 hidden", "Screens · 1 hidden, 1 selected" (a hidden screen that a preset save would cover).
static func caption(count: int) -> String:
	var hidden := 0
	var hidden_dest := 0
	for m in count:
		if DeckHidden.is_hidden(m):
			hidden += 1
			if Destinations.is_on(m):
				hidden_dest += 1
	if hidden == 0:
		return "Screens"
	return "Screens · %d hidden" % hidden + (", %d selected" % hidden_dest if hidden_dest > 0 else "")


func _label() -> void:
	var n := DeckModel.screen_count(_cm())
	text = caption(n) + " ▾"
	var any_hidden := n > DeckHidden.visible_mains(n).size()
	add_theme_color_override("font_color", ThemeBuilder.WARN if any_hidden else ThemeBuilder.TEXT)


func _toggle() -> void:
	if popup.visible:
		popup.hide()
		return
	fill()
	popup.position = Vector2i(global_position + Vector2(0, size.y + 4))  # embedded: window coords
	popup.reset_size()
	popup.popup()


## The rows: [screen name = destination toggle][eye = column shown], then "Show all".
func fill() -> void:
	for c in rows.get_children():
		rows.remove_child(c)
		c.queue_free()
	var cm := _cm()
	for m in DeckModel.screen_count(cm):
		var row := HBoxContainer.new()
		var on := Destinations.is_on(m)
		var dest := Button.new()
		dest.text = DeckModel.screen_label(cm, m)
		dest.toggle_mode = true
		dest.button_pressed = on
		dest.focus_mode = Control.FOCUS_NONE
		dest.alignment = HORIZONTAL_ALIGNMENT_LEFT
		dest.custom_minimum_size.x = 180
		dest.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		dest.tooltip_text = "Destination for look presets: click to highlight / unhighlight — a preset saves and recalls the highlighted screens"
		if on:
			for k in ["normal", "pressed", "hover", "hover_pressed"]:
				dest.add_theme_stylebox_override(k, ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, ThemeBuilder.ACCENT, 2))
			for k in ["font_color", "font_pressed_color", "font_hover_color", "font_hover_pressed_color"]:
				dest.add_theme_color_override(k, ThemeBuilder.ACCENT)
		dest.toggled.connect(func(_p: bool) -> void: Destinations.toggle(m))  # announces → fill()
		row.add_child(dest)
		var hidden := DeckHidden.is_hidden(m)
		var eye := Icons.button("eye_off" if hidden else "eye",
			"Hidden in this deck — click to show its column" if hidden else "Shown in this deck — click to hide its column (its looks stay on the show)")
		if hidden:
			eye.modulate = ThemeBuilder.WARN
		eye.pressed.connect(func() -> void: DeckHidden.set_hidden(m, not DeckHidden.is_hidden(m)))  # announces → fill()
		row.add_child(eye)
		rows.add_child(row)
	rows.add_child(HSeparator.new())
	var all := Button.new()
	all.text = "Show all"
	all.focus_mode = Control.FOCUS_NONE
	all.disabled = DeckHidden.hidden().is_empty()
	all.pressed.connect(DeckHidden.show_all)
	rows.add_child(all)
	popup.reset_size()
