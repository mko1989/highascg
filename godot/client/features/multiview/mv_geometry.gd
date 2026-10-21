extends RefCounted
## WO-600 M — multiview editor geometry, ported 1:1 from client/components/multiview-editor-canvas-layout.js
## (+ the input-channel helpers it reads from client/lib/input-channels.js) and the resize-handle hit test from
## multiview-editor-canvas-interaction.js. Pure: channel map (`cm`, the server's state.channelMap) and canvas size
## are parameters instead of the web module singletons. Golden: tests/golden/multiview_editor.json
## (tools/dev/gen-godot-golden-multiview.mjs).

const MV_TIMER_TITLE_PX := 28  # src/api/multiview-layout-helper.js MV_TIMER_TITLE_PX
const BORDER := 3
const STAGE_W := 1920.0
const STAGE_H := 1080.0
const HANDLE_SIZE := 8.0
const LIVE_TYPES := ["route", "pgm", "prv", "decklink"]


## JS Math.round (half toward +inf).
static func jround(x: float) -> float:
	return floorf(x + 0.5)


## JS parseInt(s, 10) — leading integer or null.
static func jint(s: Variant) -> Variant:
	var m := RegEx.create_from_string("^\\s*([+-]?\\d+)").search(str(s) if s != null else "")
	return int(m.get_string(1)) if m else null


static func _has_num(arr: Variant, v: Variant) -> bool:
	if not (arr is Array) or v == null:
		return false
	for e in arr:
		if e != null and (e is int or e is float) and float(e) == float(v):
			return true
	return false


static func _arr(cm: Dictionary, k: String) -> Array:
	return cm.get(k) if cm.get(k) is Array else []


static func _at(arr: Variant, i: int) -> Variant:
	return arr[i] if arr is Array and i >= 0 and i < arr.size() else null


## `c?.source?.value || c?.source` — a String when the source is a string (or has a truthy value).
static func source_value(c: Dictionary) -> Variant:
	var s: Variant = c.get("source")
	if s is Dictionary:
		var v: Variant = s.get("value")
		return v if v else s
	return s


static func _src_str(c: Dictionary) -> String:
	var s: Variant = source_value(c)
	return s if s is String else ""


static func _route_ch(src: String) -> Variant:
	return jint(src.trim_prefix("route://").split("-")[0])


static func parse_route(value: Variant) -> Variant:
	var m := RegEx.create_from_string("(?i)^route://(\\d+)(?:-(\\d+))?$").search(str(value).strip_edges() if value != null else "")
	if not m:
		return null
	var ch := int(m.get_string(1))
	if ch < 1:
		return null
	var layer: Variant = int(m.get_string(2)) if m.get_string(2) != "" else null
	return {"channel": ch, "layer": layer if layer != null and layer >= 1 else null}


static func _infer_screen(c: Dictionary, chans: Array, words: String, id_prefix: String) -> int:
	var src := _src_str(c)
	if src != "":
		var ch: Variant = _route_ch(src)
		if ch != null and _has_num(chans, ch):
			for i in chans.size():
				if chans[i] != null and float(chans[i]) == float(ch):
					return i + 1
	var lbl := str(c.get("label", "") if c.get("label") != null else "").to_lower()
	var re := RegEx.create_from_string("%s\\s*(\\d+)|%s\\s*(\\d+)|%s(\\d+)|%s\\s*s\\s*(\\d+)" % [words, id_prefix, id_prefix, id_prefix])
	var m := re.search(lbl)
	if m:
		for g in range(1, 5):
			if m.get_string(g) != "":
				var n: int = int(m.get_string(g))
				return n if n != 0 else 1
	var idm := RegEx.create_from_string("^%s(?:_(\\d+))?$" % id_prefix).search(str(c.get("id", "")))
	return int(idm.get_string(1)) + 1 if idm and idm.get_string(1) != "" else 1


static func overlay_type(c: Dictionary, cm: Dictionary) -> Variant:
	var src := _src_str(c)
	if src.contains("playback_timers.html"):
		return "timers"
	if src.begins_with("route://"):
		var ch: Variant = _route_ch(src)
		if ch != null:
			if _has_num(_arr(cm, "programChannels"), ch):
				return "pgm"
			if _has_num(_arr(cm, "previewChannels"), ch):
				return "prv"
			var ich: Variant = cm.get("inputsCh")
			if _has_num(_arr(cm, "decklinkInputChannels"), ch) or (ich != null and float(ich) == float(ch)):
				return "decklink"
	var lbl := str(c.get("label", "") if c.get("label") != null else "").to_lower()
	if RegEx.create_from_string("\\b(?:program|pgm)\\s*\\d+\\b|\\bpgm\\d+\\b|pgm\\s*s\\s*\\d+").search(lbl):
		return "pgm"
	if RegEx.create_from_string("\\b(?:preview|prv)\\s*\\d+\\b|\\bprv\\d+\\b|prv\\s*s\\s*\\d+").search(lbl):
		return "prv"
	return c.get("type")


static func _screen_idx(c: Dictionary, cm: Dictionary, pgm: bool) -> int:
	var si: Variant = c.get("screenIdx")
	if si is int or si is float:
		return int(si)
	if pgm:
		return _infer_screen(c, _arr(cm, "programChannels"), "program", "pgm") - 1
	return _infer_screen(c, _arr(cm, "previewChannels"), "preview", "prv") - 1


static func _valid_res(r: Variant) -> bool:
	return r is Dictionary and r.get("w") != null and r.get("h") != null and float(r.w) > 0 and float(r.h) > 0


static func _screen_res(c: Dictionary, cm: Dictionary, ov: Variant) -> Variant:
	if ov == "pgm":
		return _at(cm.get("programResolutions"), _screen_idx(c, cm, true))
	if ov == "prv":
		var idx := _screen_idx(c, cm, false)
		var r: Variant = _at(cm.get("previewResolutions"), idx)
		return r if r else _at(cm.get("programResolutions"), idx)
	return null


static func _num(v: Variant) -> String:
	if v == null:
		return "undefined"
	return str(int(v)) if float(v) == floorf(float(v)) else str(v)


static func resolution_suffix(c: Dictionary, cm: Dictionary) -> String:
	var r: Variant = _screen_res(c, cm, overlay_type(c, cm))
	if _valid_res(r):
		return " (%sx%s %sp)" % [_num(r.w), _num(r.h), _num(r.get("fps"))]
	return ""


static func is_decklink_input_channel(cm: Dictionary, ch: Variant) -> bool:
	if _has_num(_arr(cm, "decklinkInputChannels"), ch):
		return true
	for e in _arr(cm, "inputChannels"):
		if e is Dictionary and e.get("kind") == "decklink" and e.get("channel") != null and float(e.channel) == float(ch):
			return true
	return false


static func _res_of(r: Dictionary) -> Dictionary:
	var o := {"w": r.w, "h": r.h}
	if r.get("fps") != null:
		o.fps = r.fps
	return o


static func input_channel_resolution(cm: Dictionary, ch: Variant) -> Dictionary:
	for e in _arr(cm, "inputChannels"):
		if e is Dictionary and e.get("channel") != null and float(e.channel) == float(ch):
			var r: Variant = e.get("resolution")
			if r is Dictionary and r.get("w") and r.get("h"):
				return _res_of(r)
			break
	var ir: Variant = cm.get("inputsResolution")
	if is_decklink_input_channel(cm, ch) and ir is Dictionary and ir.get("w"):
		return _res_of(ir)
	return {"w": 1920, "h": 1080}


## Native content resolution for PGM/PRV and dedicated input routes, or null.
static func source_resolution(c: Dictionary, cm: Dictionary) -> Variant:
	var ov: Variant = overlay_type(c, cm)
	if ov == "pgm" or ov == "prv":
		var r: Variant = _screen_res(c, cm, ov)
		if _valid_res(r):
			return r
	var src := _src_str(c)
	if src.begins_with("route://"):
		var ch: Variant = _route_ch(src)
		if ch != null:
			return input_channel_resolution(cm, ch)
	return null


static func source_ratio(c: Dictionary, cm: Dictionary) -> float:
	var r: Variant = source_resolution(c, cm)
	return float(r.w) / float(r.h) if _valid_res(r) else 16.0 / 9.0


## Chrome (label / timer dock) height for a cell of stage inner height `inner_h` — mirrors the server's
## chromeReserveForCellLayout (src/engine/multiview-layout-helper.js).
static func stage_label_size(inner_h: float, ov: Variant, timers: bool) -> float:
	if ov == "timers":
		return 0.0
	var label: float
	if timers and (ov == "pgm" or ov == "prv"):
		var dock := minf(260.0, maxf(120.0, floorf(inner_h * 0.22)))
		label = minf(MV_TIMER_TITLE_PX + dock, floorf(inner_h * 0.48))
	else:
		label = jround(minf(36.0, maxf(24.0, inner_h * 0.1)))
		label = minf(label, maxf(22.0, inner_h - 20.0))
	return maxf(0.0, minf(label, maxf(0.0, inner_h - 8.0)))


## Aspect-fitted picture rect (+ label strip) of a cell, in editor-canvas px.
static func contained_video_rect(c: Dictionary, cm: Dictionary, cw: float, ch: float, timers: bool) -> Dictionary:
	cw = cw if cw else STAGE_W
	ch = ch if ch else STAGE_H
	var px := float(c.x) / cw * STAGE_W
	var py := float(c.y) / ch * STAGE_H
	var pw := float(c.w) / cw * STAGE_W
	var ph := float(c.h) / ch * STAGE_H
	var ov: Variant = overlay_type(c, cm)
	var label := 0.0 if ov == "timers" else stage_label_size(ph - BORDER * 2, ov, timers)
	var ax := px + BORDER
	var ay := py + BORDER
	var aw := pw - BORDER * 2
	var ah := ph - BORDER * 2 - label
	var v := [ax, ay, aw, ah]
	if c.get("aspectLocked") != false:
		var r: Variant = source_resolution(c, cm)
		if _valid_res(r):
			var s := minf(aw / float(r.w), ah / float(r.h))
			v = [ax + (aw - float(r.w) * s) * 0.5, ay + (ah - float(r.h) * s) * 0.5, float(r.w) * s, float(r.h) * s]
	var ex := func(val: float) -> float: return val / STAGE_W * cw
	var ey := func(val: float) -> float: return val / STAGE_H * ch
	return {"x": ex.call(v[0]), "y": ey.call(v[1]), "w": ex.call(v[2]), "h": ey.call(v[3]),
		"lx": ex.call(v[0]), "ly": ey.call(v[1] + v[3] + BORDER), "lw": ex.call(v[2]), "lh": ey.call(label)}


## Same solver in MV stage px (1920×1080).
static func solve_stage(w: float, h: float, ratio: float, lock: String, ov: Variant, timers: bool) -> Dictionary:
	if lock == "width":
		var video_h := maxf(0.0, w - BORDER * 2) / ratio
		var solved := video_h + BORDER * 2
		for i in 8:
			var nxt := video_h + BORDER * 2 + stage_label_size(maxf(0.0, solved - BORDER * 2), ov, timers)
			if absf(nxt - solved) < 0.5:
				solved = nxt
				break
			solved = nxt
		return {"w": w, "h": solved}
	var temp := maxf(0.0, h - BORDER * 2)
	var inner := maxf(1.0, temp - stage_label_size(temp, ov, timers))
	return {"w": inner * ratio + BORDER * 2, "h": h}


## Aspect-locked cell dims (editor-canvas px) so video + chrome exactly fill the cell.
static func solve_dims(w: float, h: float, ratio: float, lock: String, ov: Variant, timers: bool, cw: float, ch: float) -> Dictionary:
	cw = cw if cw else STAGE_W
	ch = ch if ch else STAGE_H
	var s := solve_stage(w / cw * STAGE_W, h / ch * STAGE_H, ratio, lock, ov, timers)
	return {"w": jround(s.w / STAGE_W * cw), "h": jround(s.h / STAGE_H * ch)}


## Resize handle under (x, y) in canvas px, or "" — tolerance HANDLE_SIZE / view scale.
static func resize_handle(c: Dictionary, x: float, y: float, scale: float) -> String:
	var tol := HANDLE_SIZE / scale
	var cx := float(c.x)
	var cy := float(c.y)
	var w := float(c.w)
	var h := float(c.h)
	if x > cx + tol and x < cx + w - tol and y > cy + tol and y < cy + h - tol:
		return ""
	var left := x >= cx - tol and x <= cx + tol
	var right := x >= cx + w - tol and x <= cx + w + tol
	var top := y >= cy - tol and y <= cy + tol
	var bottom := y >= cy + h - tol and y <= cy + h + tol
	var within_y := y >= cy - tol and y <= cy + h + tol
	var within_x := x >= cx - tol and x <= cx + w + tol
	if right and bottom: return "se"
	if left and bottom: return "sw"
	if right and top: return "ne"
	if left and top: return "nw"
	if right and within_y: return "e"
	if left and within_y: return "w"
	if bottom and within_x: return "s"
	if top and within_x: return "n"
	return ""
