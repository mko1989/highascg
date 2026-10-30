extends RefCounted
## WO-813 — the look layer's clip trim maths (layer inspector → clip_trim_section.gd): ms ↔ frames at the clip's fps,
## and the trim in / out a button press stores on the look layer (`trimInMs` / `trimOutMs`, WO-570's fields, which the
## server's take turns into SEEK / IN / LENGTH under either start option). Same convention as the web
## inspector-clip-trim.js: an in at 0 and an out at the clip's end are stored as null (no trim), so a reset
## (Ctrl+click / ↺ / right-click on Trim in / Trim out, owner 29.10) writes null. In must stay before out, both inside the clip.

const MI := preload("res://core/math_input.gd")
const M := preload("res://features/live/media_math.gd")
## The layer inspector's "Clip start point" drop-down. No "Custom" (owner 29.10): trim works under both; a stored
## legacy "custom" shows and takes as "beginning" with its trim (server: scene-play-seek.js resolveEffectiveStartBehaviour).
const STARTS := [["beginning", "Start from beginning"], ["relativeToPrevious", "Relative to the clip playing on this layer"]]


static func fps_or_default(fps: float) -> float:
	return fps if fps > 0.0 else 25.0


## ms → the frame it falls in (floor, like Caspar shows the frame at or before a seek).
static func ms_to_frame(ms: float, fps: float) -> int:
	return maxi(0, int(floor(maxf(0.0, ms) * fps_or_default(fps) / 1000.0 + 1e-6)))


static func frame_to_ms(frame: int, fps: float) -> float:
	return maxf(0.0, float(frame) * 1000.0 / fps_or_default(fps))


## A slider position snapped to the frame start, clamped into the clip.
static func snap_ms(ms: float, dur_ms: float, fps: float) -> float:
	var top := maxf(0.0, dur_ms)
	return clampf(frame_to_ms(ms_to_frame(clampf(ms, 0.0, top), fps), fps), 0.0, top)


## The in point shown (null = the clip's start).
static func in_ms(layer: Dictionary) -> float:
	var v: Variant = layer.get("trimInMs")
	return maxf(0.0, float(v)) if v != null else 0.0


## The out point shown (null = the clip's end).
static func out_ms(layer: Dictionary, dur_ms: float) -> float:
	var v: Variant = layer.get("trimOutMs")
	if v == null:
		return dur_ms
	return minf(float(v), dur_ms) if dur_ms > 0.0 else float(v)


## "Trim in" at `pos_ms` → {ok, patch, error}. Refused at or after the out point (one frame apart at least).
static func set_in(layer: Dictionary, pos_ms: float, dur_ms: float, fps: float) -> Dictionary:
	if dur_ms <= 0.0:
		return {"ok": false, "error": "Clip length unknown"}
	var p := snap_ms(pos_ms, dur_ms, fps)
	var out := out_ms(layer, dur_ms)
	if p > out - frame_to_ms(1, fps) + 0.001:
		return {"ok": false, "error": "In must be before Out"}
	return {"ok": true, "patch": {"trimInMs": int(round(p)) if p > 0.0 else null}}


## "Trim out" at `pos_ms` → {ok, patch, error}. Refused at or before the in point; at the clip's end it clears.
static func set_out(layer: Dictionary, pos_ms: float, dur_ms: float, fps: float) -> Dictionary:
	if dur_ms <= 0.0:
		return {"ok": false, "error": "Clip length unknown"}
	var p := snap_ms(pos_ms, dur_ms, fps)
	if p < in_ms(layer) + frame_to_ms(1, fps) - 0.001:
		return {"ok": false, "error": "Out must be after In"}
	return {"ok": true, "patch": {"trimOutMs": int(round(p)) if p < dur_ms - frame_to_ms(1, fps) / 2.0 else null}}


## Has an in or out point stored.
static func has_trim(layer: Dictionary) -> bool:
	return layer.get("trimInMs") != null or layer.get("trimOutMs") != null


## The points shown, clamped into the clip with in ≤ out (a stored point from a longer clip never shows past the end).
## Length unknown and no out stored → y = -1 (the clip's end).
static func points(layer: Dictionary, dur_ms: float) -> Vector2:
	var i := in_ms(layer)
	if dur_ms > 0.0:
		i = minf(i, dur_ms)
	elif layer.get("trimOutMs") == null:
		return Vector2(i, -1.0)
	var o := maxf(0.0, out_ms(layer, dur_ms))
	return Vector2(minf(i, o), o)


## A press on Trim in / Trim out that resets the point instead of setting it (owner 29.10): Ctrl+click (Cmd+click on
## macOS) or right-click. The ↺ button beside each point calls the same reset.
static func is_reset_click(e: InputEvent) -> bool:
	var mb := e as InputEventMouseButton
	if mb == null or not mb.pressed:
		return false
	if mb.button_index == MOUSE_BUTTON_RIGHT:
		return true
	return mb.button_index == MOUSE_BUTTON_LEFT and (mb.ctrl_pressed or mb.meta_pressed)


## Ctrl+click / ↺ / right-click "Trim in" → the clip's start (null = no trim). An out stored at or before the start goes too, so the
## reset never leaves in at or after out.
static func reset_in(layer: Dictionary, fps: float) -> Dictionary:
	var p := {"trimInMs": null}
	var o: Variant = layer.get("trimOutMs")
	if o != null and float(o) < frame_to_ms(1, fps) - 0.001:
		p["trimOutMs"] = null
	return {"ok": true, "patch": p}


## Ctrl+click / ↺ / right-click "Trim out" → the clip's end (null = no trim). An in at or past the end (stored for a longer clip) goes
## too, so in stays before out.
static func reset_out(layer: Dictionary, dur_ms: float, fps: float) -> Dictionary:
	var p := {"trimOutMs": null}
	if dur_ms > 0.0 and layer.get("trimInMs") != null and in_ms(layer) > dur_ms - frame_to_ms(1, fps) + 0.001:
		p["trimInMs"] = null
	return {"ok": true, "patch": p}


static func _digits(q: String) -> bool:
	return RegEx.create_from_string("^\\d+$").search(q.strip_edges()) != null


## A typed point → ms, or NAN. "m:ss.ff" / "h:mm:ss.ff" read like format_timecode writes them (.ff = frames); a plain
## number is seconds and takes + - * / (RULES.md number fields): "1.5" → 1500, "2*3" → 6000.
static func parse_tc(text: String, fps: float) -> float:
	var t := text.strip_edges()
	if t == "":
		return NAN
	if not t.contains(":"):
		var v := MI.evaluate(t)
		return NAN if is_nan(v) or v < 0.0 else v * 1000.0
	var parts := t.split(":")
	var last: String = parts[parts.size() - 1]
	var frames := 0
	if last.contains("."):
		var ff := last.get_slice(".", 1)
		if not _digits(ff):  # WO-839: digits only (is_valid_int also takes "+3" / "-3")
			return NAN
		frames = int(ff)
		last = last.get_slice(".", 0)
	parts[parts.size() - 1] = last
	var sec := 0.0
	for p in parts:
		if not _digits(p):
			return NAN
		sec = sec * 60.0 + float(int(p))
	return sec * 1000.0 + frame_to_ms(frames, fps)


## WO-843 — what the media inspector's In / Out field commits. `shown` is the text the field was last SET to (not what the
## user is typing): a commit with the same text changes nothing (a blur without an edit used to re-save the trim, and the
## shown "0:01.05" was re-read as 1.05 s, drifting it). → {} = nothing to save; {key: null} = cleared; {key: ms} = the
## point (the text is read with parse_tc, so ".ff" is frames, like the display); {"error": true} = not a time (revert).
static func field_patch(key: String, text: String, shown: String, fps: float) -> Dictionary:
	var tx := text.strip_edges()
	if tx == shown.strip_edges():
		return {}
	if tx == "":
		return {key: null}
	var ms := parse_tc(tx, fps)
	if is_nan(ms):
		return {"error": true}
	return {key: int(floor(ms + 0.5))}


## The collapsed Trim row: "Full clip" or "in – out".
static func summary(layer: Dictionary, dur_ms: float, fps: float) -> String:
	if not has_trim(layer):
		return "Full clip"
	var pt := points(layer, dur_ms)
	var tc := func(ms: float) -> String: return M.format_timecode(ms / 1000.0, fps)
	return "%s – %s" % [tc.call(pt.x), tc.call(pt.y) if pt.y >= 0.0 else "end"]


## The line under the slider for a /api/scene/layer-scrub answer.
static func scrub_note(data: Dictionary) -> String:
	if data.get("onPrv", false) == true:
		return "Scrubbing PRV (channel %d) — PGM is not touched" % int(data.get("channel", 0))
	match str(data.get("reason", "")):
		"pgm_only":
			return "This screen has no PRV — the slider only picks the points for the next take"
		"clip_not_staged":
			return "PRV holds another clip on this layer — the slider only picks the points for the next take"
		_:
			return "Look not on PRV — the slider only picks the points for the next take"
