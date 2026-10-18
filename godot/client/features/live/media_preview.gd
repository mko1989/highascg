extends VBoxContainer
## WO-601 / WO-592 — Caspar preview of a library clip in the media inspector (web inspector-media-file.js kiosk
## branch). Browsers/Godot can't decode most of the library (NotchLC/HAP/ProRes), so the clip is LOADed on the
## operator-GUI channel's MEDIA_PREVIEW_LAYER (POST /api/media/preview) and a role 'media' cell is reported in the
## operator-GUI layout; the server FILLs the layer there (aspect-fit from srcW/srcH) and answers with its plan, and
## this view draws exactly that crop of the `opgui` surface. Godot is the only local operator client (the kiosk is
## replaced, the remote browser reports no cells), so the report re-sends the current compose cells + the media
## cell — last writer wins is harmless. Silent (the GUI channel has no audio consumer); never touches PGM/PRV.
## Play starts at the trim In when outside [In, Out) and pauses at Out, like the web.

const M := preload("res://features/live/media_math.gd")
const ROLE := "opgui"
## Where the media cell goes on the operator channel (fractions): the band under the compose PRV/PGM tiles.
const BOX := {"x": 0.25, "y": 0.42, "w": 0.5, "h": 0.54}

signal position_changed

var osc_mirror: Node  # live_tab's OscMirror — file.elapsed / paused of the preview layer
var pos := 0.0
var dur := 0.0
var fps := 25.0
var trim := {}  # the file's defaults {trimInMs, trimOutMs}
var _id := ""
var _dims := Vector2i.ZERO
var _ch := -1
var _layer := -1
var _region := Rect2()  # plan fractions
var _playing := false
var _token := 0
var _view: Control
var _play: Button
var _tc: Label


func _ready() -> void:
	add_theme_constant_override("separation", 2)
	_view = Control.new()
	_view.custom_minimum_size.y = 140
	var premult := CanvasItemMaterial.new()
	premult.blend_mode = CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA
	_view.material = premult
	_view.draw.connect(_draw_view)
	add_child(_view)
	var row := HBoxContainer.new()
	_play = Button.new()
	_play.text = "▶"
	_play.tooltip_text = "Play / pause (preview on the operator channel only — silent)"
	_play.custom_minimum_size.x = 40
	_play.pressed.connect(_toggle)
	row.add_child(_play)
	_tc = Label.new()
	row.add_child(_tc)
	add_child(row)
	visibility_changed.connect(func() -> void:
		if not is_visible_in_tree():
			stop_preview())
	visible = false


## Start previewing `row` (a MOVIE from /api/media); anything else just stops the preview.
func start(row: Dictionary, duration_sec: float) -> void:
	await stop_preview()
	if str(row.get("type", "")) != "MOVIE":
		return
	_token += 1
	var tok := _token
	_id = str(row.get("id", ""))
	fps = float(row.get("fps", 25)) if float(row.get("fps", 0)) > 0 else 25.0
	dur = duration_sec
	pos = 0.0
	_dims = _parse_dims(str(row.get("resolution", "")))
	_region = Rect2()
	_set_playing(false)
	visible = true
	_view.custom_minimum_size.y = 140
	VideoSurfaces.acquire(ROLE, self)
	var r: Dictionary = await Api.post_json("/api/media/preview", {"action": "load", "id": _id})
	if tok != _token:
		return
	if not r.ok or not (r.data is Dictionary):
		_tc.text = "Preview unavailable: %s" % r.error
		return
	_ch = int(r.data.get("channel", -1))
	_layer = int(r.data.get("layer", -1))
	var plan: Variant = await _report(true)
	if tok != _token:
		return
	for e in (plan if plan is Array else []):
		if e is Dictionary and e.get("media") == true:
			_region = Rect2(float(e.x), float(e.y), float(e.w), float(e.h))
	_show_pos()


func stop_preview() -> void:
	if _id == "":
		return
	_token += 1
	_id = ""
	_ch = -1
	visible = false
	VideoSurfaces.release(ROLE, self)
	await _report(false)  # present → absent: the server STOPs + MIXER CLEARs the media layer
	await Api.post_json("/api/media/preview", {"action": "stop"})


func active() -> bool:
	return _id != "" and _ch >= 0


func seek(sec: float) -> void:
	if not active():
		return
	pos = clampf(sec, 0.0, dur if dur > 0 else sec)
	_show_pos()
	await Api.post_json("/api/media/preview", {"action": "seek", "seconds": pos})


func _exit_tree() -> void:
	stop_preview()


## POST /api/operator-gui/layout with the current compose cells (+ the media cell) → the server's plan.
func _report(with_media: bool) -> Variant:
	var g: Dictionary = await Api.get_json("/api/operator-gui/layout")
	var cells: Array = []
	if g.ok and g.data is Dictionary and g.data.get("cells") is Array:
		for c in g.data.cells:
			if c is Dictionary and str(c.get("role", "")) != "media":
				cells.append(c)
	if with_media:
		var cell := {"id": "media-preview", "role": "media", "surface": "mediainspector", "rect": BOX.duplicate()}
		if _dims.x > 0 and _dims.y > 0:
			cell["srcW"] = _dims.x
			cell["srcH"] = _dims.y
		cells.append(cell)
	var r: Dictionary = await Api.post_json("/api/operator-gui/layout", {"cells": cells})
	return r.data.get("plan") if r.ok and r.data is Dictionary else null


static func _parse_dims(s: String) -> Vector2i:
	var m := RegEx.create_from_string("(\\d+)\\s*[x×]\\s*(\\d+)").search(s)
	return Vector2i(m.get_string(1).to_int(), m.get_string(2).to_int()) if m != null else Vector2i.ZERO


func _in_sec() -> float:
	return float(trim.trimInMs) / 1000.0 if trim.get("trimInMs") != null else 0.0


func _out_sec() -> float:
	return float(trim.trimOutMs) / 1000.0 if trim.get("trimOutMs") != null else INF


func _toggle() -> void:
	if not active():
		return
	var next := not _playing
	_set_playing(next)
	if next and (pos < _in_sec() or pos >= _out_sec() - 0.05):
		pos = _in_sec()
		await Api.post_json("/api/media/preview", {"action": "seek", "seconds": pos})
	var r: Dictionary = await Api.post_json("/api/media/preview", {"action": "play" if next else "pause"})
	if not r.ok:
		_set_playing(not next)


func _set_playing(on: bool) -> void:
	_playing = on
	_play.text = "❚❚" if on else "▶"


func _show_pos() -> void:
	_tc.text = "%s / %s" % [M.format_timecode(pos, fps), M.format_timecode(dur, fps)]
	position_changed.emit()


## OSC: file.elapsed → position, paused → play state; stop at the trim Out.
func _process(_d: float) -> void:
	if not active():
		return
	_view.queue_redraw()
	if osc_mirror == null:
		return
	var ch: Variant = osc_mirror.channels.get(str(_ch))
	var ly: Variant = (ch.get("layers", {}) as Dictionary).get(str(_layer)) if ch is Dictionary and ch.get("layers") is Dictionary else null
	if not (ly is Dictionary):
		return
	var f: Variant = ly.get("file")
	if f is Dictionary:
		if not (dur > 0) and float(f.get("duration", 0)) > 0:
			dur = float(f.duration)
		var el: Variant = f.get("elapsed")
		if (el is float or el is int) and absf(float(el) - pos) > 0.001:
			pos = float(el)
			_show_pos()
	if _playing and pos >= _out_sec():
		_set_playing(false)
		Api.post_json("/api/media/preview", {"action": "pause"})
	if ly.get("paused") is bool and ly.paused == _playing:
		_set_playing(not ly.paused)


func _draw_view() -> void:
	_view.draw_rect(Rect2(Vector2.ZERO, _view.size), Color.BLACK)
	var tex := VideoSurfaces.texture(ROLE)
	var ts := tex.get_size() if tex != null else Vector2.ZERO
	if _region.size.x <= 0 or ts.x <= 0:
		return
	var src := Rect2(_region.position * ts, _region.size * ts)
	var s := minf(_view.size.x / src.size.x, _view.size.y / src.size.y)
	var dst := Rect2((_view.size - src.size * s) / 2.0, src.size * s)
	_view.draw_texture_rect_region(tex, dst, src)
