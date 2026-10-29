extends Control
## WO-789 — the Live preview as one widget (was inline in live_tab.gd): the operator channel (shm surface "opgui",
## canvas mode) under the compose windows (compose_tiles.gd), the 2D / 3D switch with Fit / Lights in 3D and Times /
## Auto in 2D, and the Auto tracking overlay (WO-710). There is one: the Live tab makes it and the Timeline tab borrows
## it while shown (`host`) — a second copy would build the 3D stage twice and its Auto would re-tile the one server
## layout against this one. View, lights, times and Auto are ui.cfg [live], so the switch is the same in both tabs.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const Icons := preload("res://app/ui_icons.gd")
const LiveStage3D := preload("res://features/live/live_stage_3d.gd")
const ComposeTiles := preload("res://features/live/compose_tiles.gd")
const AutoOverlay := preload("res://features/previs/tracking/auto_overlay.gd")
const UI_CFG := "user://ui.cfg"

static var current: Node  # the Live tab's instance — the Timeline tab reaches it through LivePreview.current

var _video: TextureRect
var _no_signal: Label
var stage3d: LiveStage3D
var tiles: ComposeTiles  # WO-621 N1: destination window outlines, labels, move / resize
var view := "standard"  # WO-621 N6: "standard" (operator picture) | "3d" (the Previs stage)
var _view_btns := {}


func _init() -> void:
	current = self


func _ready() -> void:
	clip_contents = true  # WO-648: the width-filled canvas overflows top / bottom
	_video = TextureRect.new()
	_video.texture = VideoSurfaces.texture(_role())
	visibility_changed.connect(_hold_surface)  # WO-617: read the operator surface only while shown
	_hold_surface.call_deferred()
	_video.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_video.stretch_mode = TextureRect.STRETCH_SCALE  # placed on tiles.image_rect() (_process)
	_video.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var premult := CanvasItemMaterial.new()
	premult.blend_mode = CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA
	_video.material = premult
	add_child(_video)
	_no_signal = Label.new()
	_no_signal.text = "OPERATOR CHANNEL — NO SIGNAL"
	_no_signal.add_theme_color_override("font_color", ThemeBuilder.WARN)
	_no_signal.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	add_child(_no_signal)
	tiles = ComposeTiles.new()
	tiles.role = _role()
	tiles.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(tiles)
	tiles.atlas_changed.connect(func(_on: bool) -> void: _video.visible = _show_whole())  # WO-597 §D: windows crop
	stage3d = LiveStage3D.new()
	stage3d.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	stage3d.visible = false
	add_child(stage3d)
	add_child(_view_switch())
	add_child(AutoOverlay.new())  # WO-710: Auto tracking quick sets, top-right
	gui_input.connect(func(e: InputEvent) -> void:  # a wheel off the windows pans too
		if view == "standard" and tiles.wheel(e as InputEventMouseButton):
			accept_event())
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	var lit := bool(cfg.get_value("live", "lights", true))
	(_view_btns["lights"] as Button).set_pressed_no_signal(lit)
	(_view_btns["lights"] as Button).icon = Icons.texture("bulb_on" if lit else "bulb_off", 22)
	stage3d.set_lights(lit)
	tiles.times = bool(cfg.get_value("live", "times", false))
	(_view_btns["times"] as Button).set_pressed_no_signal(tiles.times)
	(_view_btns["auto"] as Button).set_pressed_no_signal(bool(cfg.get_value("live", "auto", true)))
	tiles.set_auto(bool(cfg.get_value("live", "auto", true)))
	set_view(str(Config.args.get("live-view", cfg.get_value("live", "view", "standard"))), false)


## Move the preview into `slot` (a tab's black panel) — called by the tab that is being shown. Re-holds the surface
## and re-runs the 3D view's show / hide, which a reparent alone does not signal, and lets Auto fit the new panel.
func host(slot: Control) -> void:
	if get_parent() == slot:
		return
	if get_parent() == null:
		slot.add_child(self)
	else:
		reparent(slot, false)
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_hold_surface()
	stage3d.sync_shown()
	if is_visible_in_tree():
		tiles.refresh()


## The OSC mirror the Times rows read (live_tab's); its `updated` repaints the Times overlay while Times is on (WO-798:
## only the overlay — a whole-windows redraw at the OSC rate cost ~11 % of a core).
func set_osc(osc: Node) -> void:
	tiles.osc = osc
	osc.updated.connect(func() -> void:
		if tiles.times and tiles.is_visible_in_tree():
			tiles.redraw_times())


## WO-621 N6 / WO-649 — one 2D / 3D toggle over the preview (web previs-pgm-3d.js toggle; it names the view shown),
## then Fit and Lights in 3D. View and lights are remembered in ui.cfg.
func _view_switch() -> Control:
	var row := HBoxContainer.new()
	row.position = Vector2(8, 8)
	var v3 := Button.new()
	v3.toggle_mode = true
	v3.focus_mode = Control.FOCUS_NONE
	v3.tooltip_text = "2D: the operator channel's picture · 3D: the Previs stage and MVR model with the live pictures on its walls (drag: orbit, wheel: zoom)"
	v3.toggled.connect(func(on: bool) -> void: set_view("3d" if on else "standard"))
	row.add_child(v3)
	_view_btns["3d"] = v3
	var fit := Button.new()
	fit.text = "Fit"
	fit.tooltip_text = "Frame the whole stage"
	fit.pressed.connect(func() -> void: stage3d.fit())
	row.add_child(fit)
	_view_btns["fit"] = fit
	var lights := Button.new()  # WO-673: a bulb, lit while the beams render
	lights.toggle_mode = true
	lights.focus_mode = Control.FOCUS_NONE
	lights.tooltip_text = "Render the light beams (the heads stay either way)"
	for c in ["icon_pressed_color", "icon_hover_pressed_color"]:
		lights.add_theme_color_override(c, Color.WHITE)  # keep the lit bulb yellow, not theme-tinted
	lights.icon = Icons.texture("bulb_on", 22)
	lights.toggled.connect(func(on: bool) -> void:
		lights.icon = Icons.texture("bulb_on" if on else "bulb_off", 22)
		stage3d.set_lights(on)
		_save_ui("lights", on))
	row.add_child(lights)
	_view_btns["lights"] = lights
	var times := Button.new()  # WO-652
	times.icon = Icons.texture("clock")  # WO-659
	times.toggle_mode = true
	times.focus_mode = Control.FOCUS_NONE
	times.tooltip_text = "Times: show each layer's media / playlist time on the windows (the top running layer biggest)"
	times.toggled.connect(func(on: bool) -> void:
		tiles.times = on
		tiles.set_auto(tiles.auto)  # Auto re-tiles with (or without) room for the times
		tiles.queue_redraw()
		_save_ui("times", on))
	row.add_child(times)
	_view_btns["times"] = times
	var auto := Button.new()  # WO-658
	auto.text = "Auto"
	auto.toggle_mode = true
	auto.tooltip_text = "Lay out a PGM (top) and PRV (bottom) window per screen, fitted to this panel. Moving a window turns it off"
	auto.toggled.connect(func(on: bool) -> void:
		tiles.set_auto(on)
		_save_ui("auto", on))
	tiles.auto_changed.connect(func(on: bool) -> void:
		auto.set_pressed_no_signal(on)
		_save_ui("auto", on))
	row.add_child(auto)
	_view_btns["auto"] = auto
	return row


func set_view(v: String, save := true) -> void:
	view = "3d" if v == "3d" else "standard"
	var is3d := view == "3d"
	var b3 := _view_btns["3d"] as Button
	b3.set_pressed_no_signal(is3d)
	b3.icon = Icons.texture("cube" if is3d else "cube_face", 22)  # WO-659: "2D" in a box / three sides = 3D (WO-668: 22 px so "2D" reads)
	(_view_btns["fit"] as Button).visible = is3d
	(_view_btns["lights"] as Button).visible = is3d
	(_view_btns["times"] as Button).visible = not is3d
	(_view_btns["auto"] as Button).visible = not is3d
	stage3d.visible = is3d
	_video.visible = _show_whole()
	tiles.visible = not is3d
	_hold_surface()
	if save:
		_save_ui("view", view)


func _save_ui(key: String, value: Variant) -> void:
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	cfg.set_value("live", key, value)
	cfg.save(UI_CFG)


## The whole operator surface is drawn only in the standard view and outside atlas mode.
func _show_whole() -> bool:
	return view != "3d" and tiles.atlas.is_empty()


func _role() -> String:
	return str(Config.args.get("surface", "opgui"))


func _hold_surface() -> void:
	if is_visible_in_tree() and view == "standard":
		VideoSurfaces.acquire(_role(), self)
	else:
		VideoSurfaces.release(_role(), self)


func _process(_delta: float) -> void:
	if not is_visible_in_tree():
		return
	var ir := tiles.image_rect()
	if _video.position != ir.position or _video.size != ir.size:
		_video.position = ir.position
		_video.size = ir.size
	var r: Variant = VideoSurfaces.reader(_role())
	var lost: bool = r.signal_lost
	_no_signal.visible = lost and view == "standard"
	_video.modulate = Color(0.35, 0.35, 0.35) if lost else Color.WHITE
