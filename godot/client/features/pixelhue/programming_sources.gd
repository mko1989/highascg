extends VBoxContainer
## WO-1039 — the Programming source list, a port of Studio's public/source-tabs.js: tabs Inputs, Screens, Groups and
## (when the device gallery supports them) Backgrounds and Logos. Inputs show their physical mapping, a live /
## no-signal badge, name and resolution; a filter narrows Inputs and Screens. Drag a row onto PGM or PVW (empty space
## adds a layer, onto a layer swaps its source); double-click adds it to PVW of the active screen. Groups saves
## "two sources as one" (side by side / top-bottom). Backgrounds / Logos show the gallery thumbnails; Edit renames
## and deletes pictures, Capture PGM stores the active screen's PGM as a background. Uploading a file is left out
## (WO-1039 rule 10). No autoloads: everything goes through `host` (programming_panel.gd).

const M := preload("res://features/pixelhue/programming_model.gd")
const P := preload("res://features/pixelhue/programming_presets_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

const BADGE := {"live": Color("#9bc7aa"), "warning": Color("#e4c77b"), "off": Color("#8b949e")}

var host: Object
var tab := "inputs"
var picked := ""
var gallery_edit := false
var _state: Dictionary = {}
var _gallery: Dictionary = {}
var _tabs: HFlowContainer
var _hint: Label
var _filter: LineEdit
var _scroll: ScrollContainer
var _list: VBoxContainer


func _init() -> void:
	add_theme_constant_override("separation", 6)
	custom_minimum_size.x = 230
	var title := Label.new()
	title.text = "Sources"
	title.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	add_child(title)
	_tabs = HFlowContainer.new()  # wraps: as a tab of the Sources browser it must not widen that column
	_tabs.add_theme_constant_override("h_separation", 2)
	_tabs.add_theme_constant_override("v_separation", 2)
	add_child(_tabs)
	_hint = Label.new()
	_hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_hint.add_theme_font_size_override("font_size", 11)
	add_child(_hint)
	_filter = LineEdit.new()
	_filter.placeholder_text = "Filter"
	_filter.clear_button_enabled = true
	_filter.text_changed.connect(func(_t: String) -> void: _fill())
	add_child(_filter)
	_scroll = ScrollContainer.new()
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(_scroll)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 4)
	_scroll.add_child(_list)


## Redraw from the state (and gallery); the filter text, tab and scroll position are kept.
func render(state: Dictionary, gallery: Dictionary) -> void:
	_state = state
	_gallery = gallery
	var tabs: Array = [["inputs", "Inputs"], ["screens", "Screens"], ["groups", "Groups"]]
	if P.supports(gallery, "bkg"):
		tabs.append(["bkg", "Backgrounds"])
	if P.supports(gallery, "logo"):
		tabs.append(["logo", "Logos"])
	if not tabs.any(func(x: Array) -> bool: return x[0] == tab):
		tab = "inputs"
	for c in _tabs.get_children():
		c.queue_free()
	for x in tabs:
		var b := Button.new()
		b.text = str(x[1])
		b.toggle_mode = true
		b.button_pressed = x[0] == tab
		b.add_theme_font_size_override("font_size", 11)
		var id: String = x[0]
		b.pressed.connect(func() -> void:
			tab = id
			render(_state, _gallery)
			if id in ["bkg", "logo"] and host != null:
				host.call("load_gallery"))
		_tabs.add_child(b)
	var scroll := _scroll.scroll_vertical
	_fill()
	_scroll.set_deferred("scroll_vertical", scroll)


func _clear() -> void:
	for c in _list.get_children():
		_list.remove_child(c)
		c.queue_free()


func _fill() -> void:
	_clear()
	var listing := tab in ["inputs", "screens"]
	_filter.visible = listing
	if listing:
		_hint.text = "Drag into empty space to add at native size · drop on a layer to swap its source (Shift adds) · double-click adds to PVW"
		for s in M.filter_sources(M.arr(_state, "sources"), tab, _filter.text):
			_list.add_child(_source_row(s))
	elif tab == "groups":
		_hint.text = "Two sources placed as one, side by side or top / bottom."
		_groups()
	else:
		_pictures(1 if tab == "bkg" else 2)


# ---- rows ----

func _drag_source(b: Control, key: String, label: String) -> void:
	b.set_drag_forwarding(func(_at: Vector2) -> Variant:
		_pick(key)
		var pv := Label.new()
		pv.text = label
		b.set_drag_preview(pv)
		return {M.DRAG_KEY: key}, Callable(), Callable())
	b.gui_input.connect(func(e: InputEvent) -> void:
		if e is InputEventMouseButton and (e as InputEventMouseButton).double_click and (e as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT and host != null:
			host.call("add_to_pvw", key))


func _pick(key: String) -> void:
	picked = key
	for c in _list.find_children("*", "Button", true, false):
		if c.has_meta("key"):
			(c as Button).button_pressed = str(c.get_meta("key")) == key


func _row_button(key: String) -> Button:
	var b := Button.new()
	b.toggle_mode = true
	b.button_pressed = key == picked
	b.set_meta("key", key)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.pressed.connect(func() -> void: _pick(key))
	return b


static func _muted(text: String, size := 11) -> Label:
	var l := Label.new()
	l.text = text
	l.clip_text = true
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l


func _source_row(s: Dictionary) -> Button:
	var key := M.source_key(s.type, s.id)
	var b := _row_button(key)
	b.custom_minimum_size.y = 48 if int(s.type) == 2 else 36
	var box := VBoxContainer.new()
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT, Control.PRESET_MODE_MINSIZE, 4)
	box.add_theme_constant_override("separation", 0)
	b.add_child(box)
	if int(s.type) == 2:
		var head := HBoxContainer.new()
		head.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var map := Label.new()
		map.text = str(s.get("mapping", "")) if s.get("mapping") != null and str(s.get("mapping", "")) != "" else "Input"
		map.mouse_filter = Control.MOUSE_FILTER_IGNORE
		map.add_theme_font_size_override("font_size", 12)
		head.add_child(map)
		var badge := _muted("● " + M.signal_label(s))
		badge.add_theme_color_override("font_color", BADGE.get(M.signal_health(s), BADGE.off))
		head.add_child(badge)
		box.add_child(head)
	var name_l := Label.new()
	name_l.text = str(s.get("name", ""))
	name_l.clip_text = true
	name_l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	name_l.add_theme_font_size_override("font_size", 12)
	box.add_child(name_l)
	box.add_child(_muted(M.size_text(s)))
	b.tooltip_text = "%s · %s" % [str(s.get("name", "")), M.size_text(s)]
	_drag_source(b, key, str(s.get("name", "")))
	return b


# ---- groups ----

func _groups() -> void:
	var groups := M.arr(_state, "groupSources")
	if groups.is_empty():
		_list.add_child(_muted("No groups yet. Create one below; it stays here as a source.", 12))
	for g in groups:
		var key := "g:%s" % str(g.get("id", ""))
		var row := HBoxContainer.new()
		var b := _row_button(key)
		b.text = "%s\n%s" % [str(g.get("name", "Group")), P.group_line(_state, g)]
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.add_theme_font_size_override("font_size", 11)
		b.clip_text = true
		b.modulate.a = 1.0 if g.get("available") == true else 0.5
		_drag_source(b, key, str(g.get("name", "Group")))
		row.add_child(b)
		if g.get("onDevice") != true:
			var x := Button.new()
			x.text = "✕"
			x.flat = true
			x.tooltip_text = "Remove this group source"
			x.pressed.connect(func() -> void:
				host.call("confirm", "Remove group source %s?" % str(g.get("name", "")), func() -> void:
					host.call("command", P.group_delete(host.call("active_screen_id"), g), "Group source removed.")))
			row.add_child(x)
		_list.add_child(row)
	var form := VBoxContainer.new()
	var title := Label.new()
	title.text = "New group"
	title.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	form.add_child(title)
	var opts := P.group_options(_state)
	var a := _option(opts, 0)
	var b2 := _option(opts, 1)
	var orient := _option([["H", "Side by side"], ["V", "Top / bottom"]], 0)
	var name_e := LineEdit.new()
	name_e.placeholder_text = "Name (optional)"
	for pair in [["A (left / top)", a], ["B (right / bottom)", b2], ["Layout", orient], ["Name", name_e]]:
		form.add_child(_muted(str(pair[0])))
		form.add_child(pair[1])
	var save := Button.new()
	save.text = "Save group source"
	save.pressed.connect(func() -> void:
		var r := P.group_save(host.call("active_screen_id"), str(orient.get_item_metadata(orient.selected)), name_e.text,
			str(a.get_item_metadata(a.selected)) if a.selected >= 0 else "", str(b2.get_item_metadata(b2.selected)) if b2.selected >= 0 else "")
		if r.has("error"):
			host.call("notice", r.error)
		else:
			host.call("command", r.body, r.message))
	form.add_child(save)
	_list.add_child(HSeparator.new())
	_list.add_child(form)


static func _option(items: Array, pick: int) -> OptionButton:
	var o := OptionButton.new()
	o.fit_to_longest_item = false
	o.clip_text = true
	for i in items.size():
		o.add_item(str(items[i][1]), i)
		o.set_item_metadata(i, items[i][0])
	if not items.is_empty():
		o.select(clampi(pick, 0, items.size() - 1))
	return o


# ---- backgrounds / logos ----

func _pictures(type: int) -> void:
	_hint.text = P.gallery_help(_gallery, type) if not _gallery.is_empty() else "Loading gallery…"
	var pics := P.pictures(_gallery, type)
	if not _gallery.is_empty() and pics.is_empty():
		_list.add_child(_muted("No backgrounds in the device gallery." if type == 1 else "No logos in the device gallery.", 12))
	var flow := HFlowContainer.new()
	flow.add_theme_constant_override("h_separation", 4)
	flow.add_theme_constant_override("v_separation", 4)
	_list.add_child(flow)
	for p in pics:
		var key := "%s:%d" % ["b" if type == 1 else "l", int(p.id)]
		var card := VBoxContainer.new()
		var b := _row_button(key)
		b.custom_minimum_size = Vector2(104, 84)
		b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		b.text = str(p.get("name", ""))
		b.clip_text = true
		b.expand_icon = true
		b.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
		b.vertical_icon_alignment = VERTICAL_ALIGNMENT_TOP
		b.add_theme_font_size_override("font_size", 10)
		b.tooltip_text = "%s · %s" % [str(p.get("name", "")), P.picture_line(p)]
		_drag_source(b, key, str(p.get("name", "")))
		if host != null:
			host.call("thumb", int(p.id), func(tex: Texture2D) -> void:
				if is_instance_valid(b):
					b.icon = tex)
		card.add_child(b)
		if gallery_edit:
			var tools := HBoxContainer.new()
			var ren := Button.new()
			ren.text = "✎"
			ren.flat = true
			ren.tooltip_text = "Rename %s" % str(p.get("name", ""))
			ren.pressed.connect(func() -> void:
				host.call("prompt", "Picture name", str(p.get("name", "")), func(text: String) -> void:
					var body := P.gallery_rename(p, text)
					if not body.is_empty():
						host.call("manage_gallery", body, "Picture renamed.")))
			tools.add_child(ren)
			var del := Button.new()
			del.text = "×"
			del.flat = true
			del.disabled = p.get("used") == true
			del.tooltip_text = "In use on a screen" if p.get("used") == true else "Delete %s" % str(p.get("name", ""))
			del.pressed.connect(func() -> void:
				host.call("confirm", "Delete %s from the device gallery?" % str(p.get("name", "")), func() -> void:
					host.call("manage_gallery", P.gallery_delete(p), "Picture deleted.")))
			tools.add_child(del)
			card.add_child(tools)
		flow.add_child(card)
	var actions := HBoxContainer.new()
	if type == 1 and host != null:
		var scr: Dictionary = host.call("active_screen")
		if not scr.is_empty():
			var cap := Button.new()
			cap.text = "Capture PGM"
			cap.tooltip_text = "Store %s PGM in the device gallery as a background" % str(scr.get("name", ""))
			cap.pressed.connect(func() -> void:
				host.call("prompt", "Capture %s PGM as a background named" % str(scr.get("name", "")), P.capture_name(_gallery), func(text: String) -> void:
					var body := P.gallery_capture(scr, text)
					if not body.is_empty():
						host.call("manage_gallery", body, "PGM captured to the gallery.")))
			actions.add_child(cap)
	if not pics.is_empty():
		var ed := Button.new()
		ed.text = "Done" if gallery_edit else "Edit"
		ed.pressed.connect(func() -> void:
			gallery_edit = not gallery_edit
			_fill())
		actions.add_child(ed)
	_list.add_child(actions)
