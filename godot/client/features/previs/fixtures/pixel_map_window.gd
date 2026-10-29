extends AcceptDialog
## WO-807 phase 2 — Pixel map (Previs → Lighting → DMX output → "Pixel map…"): map rectangles of a Caspar channel's
## output to the pixels of a patched fixture (a PixelLine becomes an extension of the screen). Left: the channel's
## live picture (pixel_map_view.gd) where the operator draws, moves and resizes regions in whole channel pixels.
## Right: the selected region's x / y / w / h, and the chosen fixture's pixels (pixel_map_rows.gd) with region, mode
## and colour order per pixel and the live colour the server samples (GET /api/fixtures/pixelmap/live, polled at 2 Hz
## only while this window is open). Save POSTs the whole list to /api/fixtures/pixelmap (phase 1; the server checks
## it and keeps it in the project); a 400's errors land on their rows. Never sends DMX itself.

const P := preload("res://features/previs/fixtures/pixel_map_model.gd")
const View := preload("res://features/previs/fixtures/pixel_map_view.gd")
const Rows := preload("res://features/previs/fixtures/pixel_map_rows.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const POLL_S := 0.5

var work: Array = []  # the whole mapping list being edited (Save sends it)
var regions: Array = []  # pixel_map_model.gd regions, shared with the view
var fixtures: Array = []  # GET /api/fixtures/pixelmap/pixels
var dirty := false
var _errors := {}  # last Save's errors by "fixtureId#pixel"
var _channel: OptionButton
var _fixture: OptionButton
var _status: Label
var _view: View
var _rows: Rows
var _region_title: Label
var _fields := {}  # "x" | "y" | "w" | "h" → SpinBox
var _delete: Button
var _save: Button
var _note: Label
var _poll: Timer
var _busy := false
var _live_line := ""


func _init() -> void:
	title = "Pixel map — screen regions → fixture pixels"
	ok_button_text = "Close"
	exclusive = false
	size = Vector2i(1560, 860)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 8)
	add_child(body)
	var bar := HBoxContainer.new()
	_channel = OptionButton.new()
	_channel.tooltip_text = "The Caspar channel whose output the regions sample"
	_channel.item_selected.connect(func(_i: int) -> void: _apply_channel())
	bar.add_child(_channel)
	_fixture = OptionButton.new()
	_fixture.fit_to_longest_item = false
	_fixture.custom_minimum_size.x = 380
	_fixture.tooltip_text = "A patched fixture with colour pixels (a head selected in the 3D view is picked on open)"
	_fixture.item_selected.connect(func(_i: int) -> void: _show_fixture())
	bar.add_child(_fixture)
	var reload_b := Button.new()
	reload_b.text = "Reload"
	reload_b.tooltip_text = "Read the saved mappings again (drops unsaved changes)"
	reload_b.pressed.connect(reload)
	bar.add_child(reload_b)
	_status = Label.new()
	_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status.clip_text = true
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	bar.add_child(_status)
	body.add_child(bar)
	var split := HSplitContainer.new()
	split.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(split)
	_view = View.new()
	_view.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_view.custom_minimum_size = Vector2(640, 420)
	_view.drawn.connect(_on_drawn)
	_view.edited.connect(_on_edited)
	_view.picked.connect(_show_region)
	split.add_child(_view)
	split.add_child(_build_side())
	_poll = Timer.new()
	_poll.wait_time = POLL_S
	_poll.timeout.connect(_tick)
	add_child(_poll)
	visibility_changed.connect(func() -> void:
		_view.set_on(visible)
		if visible:
			_poll.start()
		else:
			_poll.stop())


func _build_side() -> Control:
	var side := VBoxContainer.new()
	side.custom_minimum_size.x = 600
	side.add_theme_constant_override("separation", 6)
	_region_title = Label.new()
	side.add_child(_region_title)
	var fr := HBoxContainer.new()
	for k in ["x", "y", "w", "h"]:
		var s := SpinBox.new()
		s.min_value = 0 if k in ["x", "y"] else 1
		s.max_value = 16384
		s.rounded = true
		s.prefix = k
		s.suffix = "px"
		s.select_all_on_focus = true  # RULES.md 1; SpinBox evaluates + - * / on commit (RULES.md 2)
		s.tooltip_text = {"x": "Left edge", "y": "Top edge", "w": "Width", "h": "Height"}[k] + " in channel pixels"
		s.value_changed.connect(_on_field.bind(k))
		fr.add_child(s)
		_fields[k] = s
	_delete = Button.new()
	_delete.text = "Delete region"
	_delete.tooltip_text = "Remove the region; the pixels on it become unmapped"
	_delete.pressed.connect(_delete_region)
	fr.add_child(_delete)
	side.add_child(fr)
	var hint := Label.new()
	hint.text = "Drag on the picture to draw a region · drag a region to move it, its corner to resize · wheel zoom · right-drag pan"
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	side.add_child(hint)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_rows = Rows.new()
	_rows.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_rows.changed.connect(_on_rows_changed)
	scroll.add_child(_rows)
	side.add_child(scroll)
	var foot := HBoxContainer.new()
	_save = Button.new()
	_save.text = "Save"
	_save.tooltip_text = "Send every mapping to the server (it checks them and keeps them in the project)"
	_save.pressed.connect(_save_all)
	foot.add_child(_save)
	_note = Label.new()
	_note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	foot.add_child(_note)
	side.add_child(foot)
	return side


## Show the window; unsaved edits from the last time it was open are kept, else the saved list is read.
func open() -> void:
	popup_centered()
	if dirty:
		_fill_fixtures(true)
	else:
		await reload()


func reload() -> void:
	var a: Dictionary = await Api.get_json("/api/fixtures/pixelmap")
	var b: Dictionary = await Api.get_json("/api/fixtures/pixelmap/pixels")
	if not a.ok or not (a.data is Dictionary):
		_status.text = "Pixel map not available: %s" % a.error
		return
	work = _clean(a.data.get("mappings", []))
	regions = P.regions_from(work)
	fixtures = b.data.get("fixtures", []) if b.ok and b.data is Dictionary else []
	_errors = {}
	_set_note("", false)
	_set_dirty(false)
	_fill_channels()
	_fill_fixtures(true)


## The server's view adds `problem` to each mapping; the edited list keeps the stored fields only.
static func _clean(list: Variant) -> Array:
	var out: Array = []
	for m in (list if list is Array else []):
		if m is Dictionary:
			var c: Dictionary = (m as Dictionary).duplicate(true)
			c.erase("problem")
			out.append(c)
	return out


func _cm() -> Dictionary:
	var cm: Variant = Store.get_value("channelMap", {})
	return cm if cm is Dictionary else {}


func _ch() -> int:
	return int(_channel.get_item_metadata(_channel.selected)) if _channel.selected >= 0 else 0


func _fill_channels() -> void:
	var cm := _cm()
	var keep := _ch()
	if keep == 0:
		var pgm: Variant = cm.get("programChannels")
		keep = int(regions[0].channelNo) if not regions.is_empty() else (int(pgm[0]) if pgm is Array and not pgm.is_empty() else 0)
	_channel.clear()
	for ch in P.channels(cm):
		_channel.add_item(P.channel_label(ch, cm))
		_channel.set_item_metadata(_channel.item_count - 1, ch)
		if ch == keep:
			_channel.select(_channel.item_count - 1)
	if _channel.item_count == 0:
		_channel.add_item("— no Caspar channels —")
		_channel.set_item_metadata(0, 0)
	_apply_channel()


func _apply_channel() -> void:
	var cm := _cm()
	var ch := _ch()
	_view.regions = regions
	_view.set_channel(ch, P.role_for(ch, cm) if ch > 0 else "", P.raster_of(cm, ch))
	_view.select(-1)
	_rows.set_regions(regions, ch)
	_show_region(-1)


func _fid() -> String:
	return str(_fixture.get_item_metadata(_fixture.selected)) if _fixture.selected >= 0 else ""


func _fx() -> Dictionary:
	for f in fixtures:
		if str(f.get("id", "")) == _fid():
			return f
	return {}


## prefer_sel: a pixel head selected in the 3D view wins over the current pick.
func _fill_fixtures(prefer_sel: bool) -> void:
	var ids := fixtures.map(func(f: Dictionary) -> String: return str(f.get("id", "")))
	var keep := _fid()
	for id in (Sel.shared().ids if prefer_sel else []):
		if ids.has(str(id)):
			keep = str(id)
			break
	if not ids.has(keep):
		keep = ""
		for m in work:
			if ids.has(str(m.get("fixtureId", ""))):
				keep = str(m.fixtureId)
				break
	_fixture.clear()
	for f in fixtures:
		_fixture.add_item(P.fixture_label(f))
		_fixture.set_item_metadata(_fixture.item_count - 1, str(f.id))
		if str(f.id) == keep:
			_fixture.select(_fixture.item_count - 1)
	if fixtures.is_empty():
		_fixture.add_item("— no fixtures with colour pixels in the patch —")
		_fixture.set_item_metadata(0, "")
	_show_fixture()


func _show_fixture() -> void:
	_rows.set_rows(P.rows_for(_fx(), work, regions), regions, _ch())
	_rows.set_errors(_fid(), _errors)
	_tick()


## The row ids after a build (a newly mapped pixel got an id; an unmapped one lost it) — so the next build adopts them.
func _sync_ids() -> void:
	var fresh := P.rows_for(_fx(), work, regions)
	for i in mini(fresh.size(), _rows.rows.size()):
		_rows.rows[i].id = fresh[i].id


func _on_rows_changed() -> void:
	work = P.build(work, _fid(), _rows.rows, regions)
	_sync_ids()
	_set_dirty(true)
	_show_region(_view.selected)


func _on_drawn(rect: Rect2i) -> void:
	for i in regions.size():
		if int(regions[i].channelNo) == _ch() and P.to_rect(regions[i]) == rect:
			_view.select(i)
			return
	regions.append(P.make_region(P.next_region_id(regions), _ch(), rect))
	_rows.set_regions(regions, _ch())
	_view.select(regions.size() - 1)


func _on_edited(i: int, before: Dictionary) -> void:
	work = P.move_region(work, before, regions[i])
	if P.users(work, regions[i]) > 0:
		_set_dirty(true)
	_rows.set_regions(regions, _ch())
	_show_region(i)


func _on_field(v: float, k: String) -> void:
	var i := _view.selected
	if i < 0 or i >= regions.size():
		return
	var g: Dictionary = regions[i]
	var before: Dictionary = g.duplicate()
	var r := P.to_rect(g)
	match k:
		"x": r.position.x = int(v)
		"y": r.position.y = int(v)
		"w": r.size.x = int(v)
		"h": r.size.y = int(v)
	g.merge(P.make_region(str(g.id), int(g.channelNo), P.clamp_rect(r, _view.raster)), true)
	_on_edited(i, before)
	_view.queue_redraw()


func _show_region(i: int) -> void:
	var on := i >= 0 and i < regions.size() and int(regions[i].channelNo) == _ch()
	for k in _fields:
		(_fields[k] as SpinBox).editable = on
		if on:
			(_fields[k] as SpinBox).set_value_no_signal(int(regions[i][k]))
	_delete.disabled = not on
	if not on:
		_region_title.text = "No region selected — draw one on the picture, then pick it for a pixel below."
		return
	var r := P.to_rect(regions[i])
	var bad := P.rect_problem(r, _view.raster)
	_region_title.text = "%s · %s at %d, %d · used by %d pixel(s)%s" % [regions[i].id, P.size_label(r), r.position.x,
		r.position.y, P.users(work, regions[i]), "" if bad == "" else " · " + bad]


func _delete_region() -> void:
	var i := _view.selected
	if i < 0 or i >= regions.size():
		return
	if P.users(work, regions[i]) > 0:
		work = P.drop_region(work, regions[i])
		_set_dirty(true)
	regions.remove_at(i)
	_view.select(-1)
	_show_fixture()
	_show_region(-1)


func _set_dirty(on: bool) -> void:
	dirty = on
	_save.text = "Save *" if on else "Save"
	_show_status()


func _set_note(text: String, bad: bool) -> void:
	_note.text = text
	_note.add_theme_color_override("font_color", ThemeBuilder.ERROR if bad else ThemeBuilder.TEXT_MUTED)


func _show_status() -> void:
	_status.text = "%s%s" % [_live_line, ("  · unsaved changes" if dirty else "")]


func _save_all() -> void:
	var posted := work.duplicate(true)
	_save.disabled = true
	var res: Dictionary = await Api.post_json("/api/fixtures/pixelmap", {"mappings": posted})
	_save.disabled = false
	var data: Dictionary = res.data if res.data is Dictionary else {}
	if res.ok:
		work = _clean(data.get("mappings", []))
		_errors = {}
		_set_dirty(false)
		var off: Array = (data.get("mappings", []) as Array).filter(func(m: Variant) -> bool:
			return m is Dictionary and m.get("enabled", true) != false and m.get("problem") != null)
		_set_note("Saved %d mapping(s).%s" % [work.size(), "" if off.is_empty() else
			" %d not output: %s" % [off.size(), str(off[0].problem)]], not off.is_empty())
		_show_fixture()
		return
	if res.status == 400 and data.get("errors") is Array:
		var e := P.row_errors(data.errors, posted)
		_errors = e.by_target
		_rows.set_errors(_fid(), _errors)
		var here := (_errors.keys() as Array).filter(func(k: String) -> bool: return k.begins_with(_fid() + "#")).size()
		var elsewhere := _errors.size() - here
		_set_note("Not saved: %d error(s) on this fixture's pixels%s%s" % [here,
			"" if elsewhere == 0 else ", %d on other fixtures' pixels" % elsewhere,
			"" if e.other.is_empty() else " · " + "; ".join(e.other)], true)
		return
	_set_note("Not saved: %s" % res.error, true)


func _tick() -> void:
	if _busy or not visible:
		return
	_busy = true
	var res: Dictionary = await Api.get_json("/api/fixtures/pixelmap/live")
	_busy = false
	if not visible:
		return
	var data: Dictionary = res.data if res.ok and res.data is Dictionary else {}
	var by := P.live_by_id(data)
	_rows.set_live(by)
	var colours := {}
	for m in work:
		var l: Variant = by.get(str(m.get("id", "")))
		var rid := P.region_for(regions, m)
		if l != null and l.color is Color and rid != "" and not colours.has(rid):
			colours[rid] = l.color
	_view.colours = colours
	_live_line = "live colours unavailable: %s" % res.error if not res.ok else "no saved mapping on channel %d" % _ch()
	for c in data.get("channels", []):
		if int(c.get("channelNo", 0)) == _ch():
			_live_line = "channel %d (%s): %s · %d mapping(s) sampled" % [_ch(), c.get("role", "?"), c.get("state", "?"), int(c.get("mappings", 0))]
	_show_status()
