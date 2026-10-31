extends VBoxContainer
## WO-622 — the Sources "Live" tab (web sources-panel-live-render.js): live sources as rows — thumbnail, name,
## resolution · rate line, warning line — that drag {type, value, label, …} onto the look editor's compose frame like
## media rows do. Rows come from live_sources_model.gd over the effective channel map, state.extraLiveSources, the
## device-view connectors and the live-audio / USB configs; the list is rebuilt only when what it shows changes
## (WO-401: status objects re-stamp on every routing retry). Thumbnails (/api/thumbnail/live/<ch>) are fetched once
## per channel per reload (the tab showing); the server captures each one once per session on a non-black frame and
## says when that capture is still pending (WO-887) — then the row re-fetches a bounded number of times.
## A DeckLink port dragged off the Devices rear panel onto Sources is mapped here (WO-605 slice 12,
## decklink_drop_flow.gd): progress / errors show at the top of this tab, and the new source is highlighted in the list.
## Not ported: per-row actions (Stop, Apply PLAY, ⛶ operator monitor, host inspectors, capture / upload thumbnail —
## manual recapture is API-only by owner request: POST /api/thumbnail/live/recapture, WO-887).

signal tab_requested(name: String)
signal caspar_changed
signal connector_dropped

const M := preload("res://features/live/live_sources_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const LookThumb := preload("res://features/live/look_thumb.gd")
const Drop := preload("res://features/devices/decklink_drop_flow.gd")
const DropIo := preload("res://features/devices/decklink_drop_io.gd")
const Shm := preload("res://features/live/shm_sources_model.gd")  # WO-744
const STATE_KEYS := ["*", "channelMap", "extraLiveSources", "decklinkInputsStatus", "liveAudioInputsStatus", "v4l2InputsStatus"]
const THUMB := Vector2(48, 27)
const THUMB_REFETCH_MAX := 8  # WO-887: re-fetches per channel while the server's session capture is pending

var _note: Label
var _list: VBoxContainer
var _scroll: ScrollContainer
var _connectors: Array = []
var _audio: Variant = null  # GET /api/audio/live-inputs
var _v4l2: Variant = null   # GET /api/v4l2-inputs
var _shm: Variant = null    # GET /api/shm/sources (WO-744)
var _key := ""
var _thumbs := {}  # channel → Texture2D (null while fetching / when the fetch failed)
var _thumb_rects := {}  # channel → Array[TextureRect] of the current rows (a re-fetch updates every one)
var _thumb_gen := 0  # bumped by reload(): a pending re-fetch of an older generation drops out
var _highlight := ""  # connector id of a DeckLink just dropped here
var dropping := false


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_note = Label.new()
	_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_note.add_theme_font_size_override("font_size", 12)
	_note.visible = false
	add_child(_note)
	_scroll = ScrollContainer.new()
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(_scroll)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 2)
	_scroll.add_child(_list)
	_scroll.set_drag_forwarding(Callable(), can_drop_connector, func(_at: Vector2, data: Variant) -> void: drop_connector(Drop.parse(data)))
	Store.changed.connect(func(path: String, _v: Variant) -> void:
		if path in STATE_KEYS:
			_rebuild())
	Settings.changed.connect(_rebuild)
	Settings.loaded.connect(_rebuild)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			reload())
	var shm_poll := Timer.new()  # WO-883: a ring started while this list is open (Visuals ▸ Live source) shows up by itself
	shm_poll.wait_time = 3.0
	shm_poll.timeout.connect(_poll_shm)
	add_child(shm_poll)
	shm_poll.start()
	reload()


## WO-883: only the shm rings, every 3 s while shown; _rebuild skips when nothing changed.
func _poll_shm() -> void:
	if not is_visible_in_tree():
		return
	var sh: Dictionary = await Api.get_json("/api/shm/sources")
	if sh.ok:  # a missed poll keeps the rows
		_shm = sh.data
		_rebuild()


## Re-reads the connectors and the live-audio / USB configs (and refetches thumbnails).
func reload() -> void:
	var dv: Dictionary = await Api.get_json("/api/device-view")
	var d: Dictionary = dv.data if dv.ok and dv.data is Dictionary else {}
	_connectors = []
	for part in [d.get("graph"), d.get("suggested")]:
		if part is Dictionary and part.get("connectors") is Array:
			_connectors.append_array(part.connectors)
	var a: Dictionary = await Api.get_json("/api/audio/live-inputs")
	_audio = a.data if a.ok else null
	var v: Dictionary = await Api.get_json("/api/v4l2-inputs")
	_v4l2 = v.data if v.ok else null
	var sh: Dictionary = await Api.get_json("/api/shm/sources")  # WO-744
	_shm = sh.data if sh.ok else null
	_thumbs.clear()
	_thumb_gen += 1
	_key = ""
	_rebuild()


func _rows() -> Array:
	var cm: Variant = M.effective_cm(Settings.settings.get("channelMap"), Store.get_value("channelMap"))
	return M.sources(cm, _connectors, _audio, _v4l2, Store.get_value("extraLiveSources", [])) + Shm.rows(_shm)  # WO-744


func _rebuild() -> void:
	if _list == null:
		return
	var rows := _rows()
	var status := {"decklink": Store.get_value("decklinkInputsStatus"), "audio": Store.get_value("liveAudioInputsStatus"),
		"v4l2": Store.get_value("v4l2InputsStatus")}
	var view := rows.map(func(s: Dictionary) -> Array:
		return [s.get("value"), s.get("label"), M.meta(s) + Shm.meta_suffix(s), M.slot_message(s, status) + Shm.warning(s),
			M.thumb_channel(s), s.get("connectorId")])
	var key := JSON.stringify([view, _highlight])
	if key == _key:
		return
	_key = key
	for c in _list.get_children():
		c.queue_free()
	_thumb_rects.clear()
	var focus: Control = null
	for i in rows.size():
		var row := _row(rows[i], view[i])
		_list.add_child(row)
		if _highlight != "" and str(view[i][5]) == _highlight:
			focus = row
	if focus != null:
		_scroll.ensure_control_visible.call_deferred(focus)


func _row(s: Dictionary, v: Array) -> Control:
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = ThemeBuilder.BG_ELEVATED if _highlight != "" and str(v[5]) == _highlight else ThemeBuilder.BG_PANEL
	sb.border_color = ThemeBuilder.ACCENT
	sb.set_border_width_all(1 if _highlight != "" and str(v[5]) == _highlight else 0)
	sb.set_content_margin_all(4)
	sb.set_corner_radius_all(3)
	panel.add_theme_stylebox_override("panel", sb)
	panel.tooltip_text = "%s\n%s\nDrag onto the look editor to add a layer" % [str(v[1]), str(v[0])]
	# WO-887: no CURSOR_DRAG (the move-arrows cross) — rows show the normal arrow like Media rows; drag still works.
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 8)
	h.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(h)
	var thumb := TextureRect.new()
	thumb.custom_minimum_size = THUMB
	thumb.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	thumb.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	thumb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if v[4] != null:
		_thumb(int(v[4]), thumb)
	h.add_child(thumb)
	var col := VBoxContainer.new()
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_theme_constant_override("separation", 0)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	h.add_child(col)
	for line in [[str(v[1]), 13, ThemeBuilder.TEXT], [str(v[2]), 11, ThemeBuilder.TEXT_MUTED], [str(v[3]), 11, ThemeBuilder.WARN]]:
		if line[0] == "":
			continue
		var l := Label.new()
		l.text = line[0]
		l.clip_text = true
		l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		l.add_theme_font_size_override("font_size", line[1])
		l.add_theme_color_override("font_color", line[2])
		l.mouse_filter = Control.MOUSE_FILTER_IGNORE
		col.add_child(l)
	panel.set_drag_forwarding(func(_at: Vector2) -> Variant:
		var p := Label.new()
		p.text = "＋ " + str(v[1])
		set_drag_preview(p)
		return M.drag_payload(s), can_drop_connector, func(_at: Vector2, data: Variant) -> void: drop_connector(Drop.parse(data)))
	return panel


func _thumb(ch: int, rect: TextureRect) -> void:
	if not _thumb_rects.has(ch):
		_thumb_rects[ch] = []
	_thumb_rects[ch].append(rect)
	if _thumbs.has(ch):
		rect.texture = _thumbs[ch]
		return
	_thumbs[ch] = null
	_fetch_thumb(ch, _thumb_gen, 0)


## WO-887: while the server's once-per-session capture is pending (Retry-Ms header) re-fetch a bounded number of
## times; the server's retry schedule is bounded too, so this ends. A reload() starts a new generation.
func _fetch_thumb(ch: int, gen: int, tries: int) -> void:
	var r: Dictionary = await Api.get_bytes("/api/thumbnail/live/%d" % ch)
	if gen != _thumb_gen:
		return
	var tex: Texture2D = LookThumb.decode(r.bytes) if r.ok else null
	if tex != null or _thumbs.get(ch) == null:
		_thumbs[ch] = tex
	for rect in _thumb_rects.get(ch, []):
		if is_instance_valid(rect):
			rect.texture = _thumbs[ch]
	var wait_ms := M.thumb_retry_ms(r.get("headers", PackedStringArray()))
	if wait_ms < 0 or tries >= THUMB_REFETCH_MAX or not is_inside_tree():
		return
	await get_tree().create_timer(wait_ms / 1000.0).timeout
	if gen == _thumb_gen and is_visible_in_tree():
		_fetch_thumb(ch, gen, tries + 1)


func can_drop_connector(_at: Vector2, data: Variant) -> bool:
	return not dropping and Drop.parse(data) != ""


## mapDecklinkToLiveInput, one at a time; the new source is highlighted when it lands.
func drop_connector(cid: String) -> void:
	if cid == "" or dropping:
		return
	dropping = true
	_highlight = ""
	var io := DropIo.new()
	var ok := [true]
	io.on_status = func(text: String, good: bool) -> void:
		ok[0] = good
		_note.text = text
		_note.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED if good else ThemeBuilder.ERROR)
		_note.visible = true
	io.on_dirty = func() -> void: caspar_changed.emit()
	io.on_tab = func(name: String) -> void: tab_requested.emit(name)
	await Drop.new(io).to_live_input(cid)
	dropping = false
	if ok[0]:
		_note.visible = false
		_highlight = cid
	connector_dropped.emit()
	await reload()
