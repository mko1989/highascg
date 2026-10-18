extends VBoxContainer
## WO-601 / WO-592 — media file inspector (client/components/inspector-media-file*.js): facts, waveform with
## trim shading, per-file trim/mute defaults, "used in", rename (extension kept), final delete. Library
## endpoints key by the LOCAL path; Caspar-only ids get facts + waveform only. Versions: media_versions.gd. Caspar preview
## of MOVIE files: media_preview.gd (click the waveform to seek).

signal library_changed

const M := preload("res://features/live/media_math.gd")
const Versions := preload("res://features/live/media_versions.gd")
const Preview := preload("res://features/live/media_preview.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const WAVE := Color("#6e7681")
const TRIM := Color("#f0b429")

var id := ""
var _row: Dictionary = {}
var _fps := 25.0
var _dur := 0.0
var _peaks: Array = []
var _defaults: Dictionary = {}
var _usage: Array = []
var _in_lib := false
var _facts: Label
var _wave: Control
var _lib: VBoxContainer
var _in: LineEdit
var _out: LineEdit
var _mute: CheckBox
var _used: Label
var _msg: Label
var _versions: Versions
var preview: Preview
var osc_mirror: Node  # the shell's OscMirror, handed to the preview (built in _ready — the page joins the tree on first select)


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_facts = Label.new()
	_facts.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_facts)
	preview = Preview.new()
	preview.osc_mirror = osc_mirror
	preview.position_changed.connect(func() -> void: _wave.queue_redraw())
	add_child(preview)
	_wave = Control.new()
	_wave.custom_minimum_size.y = 48
	_wave.draw.connect(_draw_wave)
	_wave.gui_input.connect(func(ev: InputEvent) -> void:
		if ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_LEFT and _dur > 0 and preview.active():
			preview.seek(clampf(ev.position.x / maxf(1.0, _wave.size.x), 0.0, 1.0) * _dur))
	add_child(_wave)
	_lib = VBoxContainer.new()
	add_child(_lib)
	var trim := HBoxContainer.new()
	_in = _time_field(trim, "In", "start", "trimInMs")
	_out = _time_field(trim, "Out", "end", "trimOutMs")
	var clr := Button.new()
	clr.text = "✕"
	clr.tooltip_text = "Clear trim"
	clr.pressed.connect(func() -> void: _save({"trimInMs": null, "trimOutMs": null}))
	trim.add_child(clr)
	_lib.add_child(trim)
	_mute = CheckBox.new()
	_mute.text = "Mute audio"
	_mute.toggled.connect(func(on: bool) -> void: _save({"muted": on}))
	_lib.add_child(_mute)
	var hint := Label.new()
	hint.text = "Trim and mute are this file's defaults — a look layer copies them when the clip is added."
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_lib.add_child(hint)
	_used = Label.new()
	_used.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_lib.add_child(_used)
	var acts := HBoxContainer.new()
	var rn := Button.new()
	rn.text = "Rename…"
	rn.pressed.connect(_rename)
	acts.add_child(rn)
	var del := Button.new()
	del.text = "Delete"
	del.add_theme_color_override("font_color", ThemeBuilder.ACCENT_RED)
	del.pressed.connect(_delete)
	acts.add_child(del)
	_lib.add_child(acts)
	_versions = Versions.new()
	_versions.changed.connect(func() -> void:  # web reselect(): rescan, reload this file's view
		library_changed.emit()
		show_media(_row))
	_lib.add_child(_versions)
	_msg = Label.new()
	_msg.add_theme_color_override("font_color", ThemeBuilder.ACCENT_RED)
	add_child(_msg)
	visible = false


func show_media(row: Dictionary) -> void:
	_row = row
	id = str(row.get("id", ""))
	visible = id != ""
	if id == "":
		preview.stop_preview()
		return
	_fps = float(row.get("fps", 25)) if float(row.get("fps", 0)) > 0 else 25.0
	_dur = float(row.get("durationMs", 0)) / 1000.0
	_peaks = []
	_msg.text = ""
	_show_facts(-1)
	var want := id
	var wr: Dictionary = await Api.get_json("/api/local-media/%s/waveform?bars=600" % id.uri_encode())
	if want != id:
		return
	if wr.ok and wr.data is Dictionary:
		_peaks = wr.data.get("peaks", [])
		if float(wr.data.get("durationMs", 0)) > 0:
			_dur = float(wr.data.durationMs) / 1000.0
	preview.trim = {}
	preview.start(row, _dur)
	var er: Dictionary = await Api.get_json("/api/media/library/entry?path=%s" % id.uri_encode())
	if want != id:
		return
	_in_lib = er.ok and er.data is Dictionary and er.data.get("entry") is Dictionary
	_lib.visible = _in_lib
	if _in_lib:
		_defaults = er.data.entry.get("defaults", {}) if er.data.entry.get("defaults") is Dictionary else {}
		_usage = er.data.get("usage", []) if er.data.get("usage") is Array else []
		_show_facts(int(er.data.entry.get("size", -1)))
		_versions.show_entry(id, er.data.entry)
		preview.trim = _defaults
		_sync()
	else:
		_defaults = {}
		_msg.text = ""
		_facts.text += "\nNot in the media library (Caspar clip id) — defaults/rename/delete live on the local file."
	_wave.queue_redraw()


func _show_facts(size: int) -> void:
	var slash := id.rfind("/")
	var t := "%s\n%s · %s · %s @ %s fps" % [id.substr(slash + 1), id.substr(0, maxi(0, slash)) if slash > 0 else "(root)",
		str(_row.get("type", "?")), M.format_timecode(_dur, _fps), str(_row.get("fps", "?"))]
	if size > 0:
		t += " · %.1f MB" % (size / 1048576.0)
	_facts.text = t


func _sync() -> void:
	var tc := func(ms: Variant) -> String: return "" if ms == null else M.format_timecode(float(ms) / 1000.0, _fps)
	_in.text = tc.call(_defaults.get("trimInMs"))
	_out.text = tc.call(_defaults.get("trimOutMs"))
	_mute.set_pressed_no_signal(_defaults.get("muted", false) == true)
	var n := 0
	var names := PackedStringArray()
	for u in _usage:
		n += int(u.get("count", 0))
		names.append("%s “%s”" % [u.get("kind", "?"), u.get("name", u.get("id", "?"))])
	_used.text = ("Used in: " + ", ".join(names)) if not names.is_empty() else "Not used in any look or timeline."
	_wave.queue_redraw()


func _time_field(row: HBoxContainer, label: String, ph: String, key: String) -> LineEdit:
	var l := Label.new()
	l.text = label
	row.add_child(l)
	var e := LineEdit.new()
	e.placeholder_text = ph
	e.custom_minimum_size.x = 80
	var commit := func() -> void:
		var sec: Variant = M.parse_time_input(e.text)
		if sec is float and is_nan(sec):
			_msg.text = "Use seconds or m:ss.ff"
			_sync()
			return
		_save({key: null if sec == null else int(floor(float(sec) * 1000.0 + 0.5))})
	e.text_submitted.connect(func(_t: String) -> void: commit.call())
	e.focus_exited.connect(commit)
	row.add_child(e)
	return e


func _save(patch: Dictionary) -> void:
	if not _in_lib:
		return
	var body := {"path": id}
	body.merge(patch, true)
	var r: Dictionary = await Api.post_json("/api/media/library/defaults", body)
	if r.ok and r.data is Dictionary:
		_defaults = r.data.get("defaults", {}) if r.data.get("defaults") is Dictionary else {}
		preview.trim = _defaults
		_msg.text = ""
	else:
		_msg.text = "Could not save: %s" % r.error
	_sync()


func _draw_wave() -> void:
	var w := _wave.size.x
	var h := _wave.size.y
	_wave.draw_rect(Rect2(Vector2.ZERO, _wave.size), Color(0, 0, 0, 0.3))
	var n := _peaks.size()
	if n > 0:
		for x in int(w):
			var v := clampf(float(_peaks[mini(n - 1, int(floor(x / w * n)))]), 0.0, 1.0)
			var bh := maxf(1.0, v * (h - 2.0))
			_wave.draw_rect(Rect2(x, h / 2.0 - bh / 2.0, 1, bh), WAVE)
	if _dur > 0.0:
		var ti: Variant = _defaults.get("trimInMs")
		var to: Variant = _defaults.get("trimOutMs")
		if ti != null:
			var xi := clampf(float(ti) / 1000.0 / _dur, 0.0, 1.0) * w
			_wave.draw_rect(Rect2(0, 0, xi, h), Color(0, 0, 0, 0.55))
			_wave.draw_rect(Rect2(xi, 0, 2, h), TRIM)
		if to != null:
			var xo := clampf(float(to) / 1000.0 / _dur, 0.0, 1.0) * w
			_wave.draw_rect(Rect2(xo, 0, w - xo, h), Color(0, 0, 0, 0.55))
			_wave.draw_rect(Rect2(xo, 0, 2, h), TRIM)
		if preview.active():
			_wave.draw_rect(Rect2(clampf(preview.pos / _dur, 0.0, 1.0) * w, 0, 1, h), ThemeBuilder.ERROR)


func _rename() -> void:
	var slash := id.rfind("/")
	var folder := id.substr(0, slash + 1)
	var base := id.substr(slash + 1)
	var dot := base.rfind(".")
	var ext := base.substr(dot) if dot > 0 else ""
	var dlg := ConfirmationDialog.new()
	dlg.title = "Rename (the extension %s stays)" % ext
	var e := LineEdit.new()
	e.text = base.substr(0, dot) if dot > 0 else base
	e.custom_minimum_size.x = 360
	dlg.add_child(e)
	dlg.confirmed.connect(func() -> void:
		var next := e.text.strip_edges()
		dlg.queue_free()
		if next == "" or next + ext == base:
			return
		var to := folder + next + ext
		await preview.stop_preview()  # Caspar holds the file open while it previews
		var r: Dictionary = await Api.post_json("/api/media/rename", {"renames": [{"from": id, "to": to}]})
		if r.ok:
			id = to
			library_changed.emit()
		else:
			_msg.text = "Rename failed — nothing changed (%s)" % r.error)
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()


func _delete() -> void:
	var n := 0
	for u in _usage:
		n += int(u.get("count", 0))
	var dlg := ConfirmationDialog.new()
	dlg.title = "Delete permanently?"
	dlg.dialog_text = "Delete \"%s\" permanently?%s\n\nThis is final — the file cannot be recovered." % [id.substr(id.rfind("/") + 1),
		("\n\nIt is used %d time(s) in %d look(s)/timeline(s) — those will show it as missing." % [n, _usage.size()]) if not _usage.is_empty() else ""]
	dlg.confirmed.connect(func() -> void:
		dlg.queue_free()
		await preview.stop_preview()
		var r: Dictionary = await Api.post_json("/api/media/delete", {"id": id})
		if r.ok:
			visible = false
			library_changed.emit()
		else:
			_msg.text = "Delete failed: %s" % r.error)
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()
