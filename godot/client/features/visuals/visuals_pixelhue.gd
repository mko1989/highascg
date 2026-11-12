extends VBoxContainer
## WO-1050 — the Visuals Inspector page's PixelHue block (owner 12.11: "route fader 3 to opacity of pixelhue layer, so i
## can control the layer from the controller"): one opacity slider per layer on the switcher's program screens
## (GET /api/pixelhue/layers?scene=pgm). Each slider is the MIDI target "pxl:<layerId>" (visuals_midi_pxl.gd): Learn
## (move a fader, click the slider) binds it like any slider, with the same soft takeover. A move — by hand, MIDI or the
## virtual controller — posts POST /api/pixelhue/layer-opacity at most every THROTTLE_MS per layer with one request in
## flight per layer (the server coalesces too). On a refresh a slider follows the switcher's value unless it was moved in
## the last FOLLOW_IDLE_MS. Shown only while a PixelHue is set (Devices ▸ PixelHue); visuals_midi.gd ticks it.

const MidiMap := preload("res://features/midi/midi_map.gd")
const PATH := "/api/pixelhue/layer-opacity"
const THROTTLE_MS := 50  # ~20 Hz per layer
const FOLLOW_IDLE_MS := 1500
const REFRESH_SHOWN_MS := 3000  # the page on screen
const REFRESH_HIDDEN_MS := 10000  # off screen: the sliders must still be there for a fader
const SKIP_TYPES := ["bkg", "mvr", "aux", "cut"]  # no opacity on the P80 (bkg / mvr: code 8210), cut follows its fill

var poster: Callable  ## tests: (layerId: int, opacity: int) -> void instead of the HTTP post
var rows := {}  ## layerId → {box, slider: HSlider, title: Label, value: Label}
var _box: VBoxContainer
var _note: Label
var _pending := {}  # layerId → the opacity waiting for its slot
var _last := {}  # layerId → msec of its last post
var _busy := {}  # layerId → a post in flight
var _touched := {}  # layerId → msec of the last local move
var _dragging := {}
var _next_refresh := 0
var _loading := false


func _init() -> void:
	visible = false
	add_theme_constant_override("separation", 2)
	var head := Label.new()
	head.text = "PixelHue"
	head.add_theme_font_size_override("font_size", 15)
	add_child(head)
	_note = Label.new()
	_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_note.modulate = Color(1, 0.75, 0.6, 0.9)
	_note.visible = false
	add_child(_note)
	_box = VBoxContainer.new()
	_box.add_theme_constant_override("separation", 2)
	add_child(_box)


## The layers a slider is offered for: program layers of enabled screens, enabled, of a kind that has an opacity.
## → [{id, name, screen, opacity}]
static func layers_of(data: Variant) -> Array:
	var out := []
	if not data is Dictionary:
		return out
	for s in data.get("screens", []):
		if not s is Dictionary or s.get("enabled") != true:
			continue
		for l in s.get("layers", []):
			if not l is Dictionary or l.get("enabled") != true or str(l.get("scene", "")) != "pgm":
				continue
			if str(l.get("type", "")) in SKIP_TYPES or not (l.get("layerId") is float or l.get("layerId") is int):
				continue
			var name := str(l.get("name", "")).strip_edges()
			out.append({"id": int(l.layerId), "name": name if name != "" else "Layer %d" % int(l.layerId),
				"screen": str(s.get("name", "")).strip_edges(), "opacity": clampf(float(l.get("opacity", 100)), 0.0, 100.0)})
	return out


func ids() -> Array:
	return rows.keys()


func slider_of(id: int) -> HSlider:
	var r: Variant = rows.get(id)
	return r.slider if r is Dictionary else null


## A layer list read from the server: rows added / removed (a kept layer keeps its slider: its MIDI pickup stays), the
## names for the MIDI labels, and every slider nobody is moving set to the switcher's value.
func set_layers(data: Variant, now: int) -> void:
	var list := layers_of(data)
	var keep := {}
	for i in list.size():
		var l: Dictionary = list[i]
		keep[l.id] = true
		if not rows.has(l.id):
			rows[l.id] = _row(l.id)
		var r: Dictionary = rows[l.id]
		r.title.text = l.name
		r.title.tooltip_text = "%s · %s — PixelHue layer %d. MIDI Learn: move a fader, then click this slider." % [l.screen, l.name, l.id]
		_box.move_child(r.box, i)
		MidiMap.pxl_names[str(l.id)] = l.name
		if not _pending.has(l.id) and not _busy.get(l.id, false) and not _dragging.get(l.id, false) \
				and now - int(_touched.get(l.id, -FOLLOW_IDLE_MS)) >= FOLLOW_IDLE_MS:
			r.slider.set_value_no_signal(l.opacity)
			r.value.text = "%d %%" % roundi(l.opacity)
	for id in rows.keys():
		if not keep.has(id):
			(rows[id].box as Node).queue_free()
			rows.erase(id)
	_say("" if not list.is_empty() else "No program layers with an opacity on the switcher.")
	visible = true


## A move: queued, sent when the layer's slot is free.
func queue(id: int, opacity: int, now: int) -> void:
	_pending[id] = clampi(opacity, 0, 100)
	_touched[id] = now
	flush(now)


func flush(now: int) -> void:
	for id in _pending.keys():
		if _busy.get(id, false) or (_last.has(id) and now - int(_last[id]) < THROTTLE_MS):
			continue
		var v: int = _pending[id]
		_pending.erase(id)
		_last[id] = now
		if poster.is_valid():
			poster.call(id, v)
		else:
			_post(id, v)


## Every 0.1 s (visuals_midi.gd tick): waiting moves go out; the list is re-read now and then.
func tick(now: int) -> void:
	flush(now)
	if _loading or now < _next_refresh:
		return
	var page := get_parent() as Control
	_next_refresh = now + (REFRESH_SHOWN_MS if page != null and page.is_visible_in_tree() else REFRESH_HIDDEN_MS)
	refresh()


func refresh() -> void:
	var api := _api()
	if api == null:
		return
	_loading = true
	var r: Dictionary = await api.get_json("/api/pixelhue/layers?scene=pgm")
	_loading = false
	if r.ok:
		set_layers(r.data, Time.get_ticks_msec())
	elif int(r.get("status", 0)) == 409:  # no PixelHue set: no block, no targets
		visible = false
		for id in rows.keys():
			(rows[id].box as Node).queue_free()
		rows.clear()
	elif int(r.get("status", 0)) == 502:  # set but not answering: the sliders stay (a fader keeps its binding)
		visible = true
		_say(str(r.get("error", "The PixelHue does not answer")))


func _post(id: int, v: int) -> void:
	var api := _api()
	if api == null:
		return
	_busy[id] = true
	var r: Dictionary = await api.post_json(PATH, {"layerId": id, "opacity": v})
	_busy.erase(id)
	var err := str(r.get("error", "")) if not r.ok else str((r.data as Dictionary).get("error", "")) if r.data is Dictionary else ""
	_say("PixelHue: " + err if err != "" else "")
	flush(Time.get_ticks_msec())


func _row(id: int) -> Dictionary:
	var box := HBoxContainer.new()
	var title := Label.new()
	title.custom_minimum_size.x = 70
	title.clip_text = true
	title.mouse_filter = Control.MOUSE_FILTER_PASS
	box.add_child(title)
	var s := HSlider.new()
	s.max_value = 100.0
	s.step = 1.0
	s.value = 100.0
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.tooltip_text = "The switcher layer's opacity"
	box.add_child(s)
	var value := Label.new()
	value.custom_minimum_size.x = 44
	value.text = "100 %"
	box.add_child(value)
	s.value_changed.connect(func(v: float) -> void:
		value.text = "%d %%" % roundi(v)
		queue(id, roundi(v), Time.get_ticks_msec()))
	s.drag_started.connect(func() -> void: _dragging[id] = true)
	s.drag_ended.connect(func(_changed: bool) -> void: _dragging.erase(id))
	_box.add_child(box)
	return {"box": box, "slider": s, "title": title, "value": value}


func _say(text: String) -> void:
	_note.text = text
	_note.visible = text != ""


func _api() -> Node:
	var tree := Engine.get_main_loop() as SceneTree
	return tree.root.get_node_or_null("Api") if tree != null else null
