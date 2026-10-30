extends RefCounted
## WO-865 — one bus of the demo display engine (pure model, no nodes): the look the simulated server has on a channel
## (`scene.live[ch]`), what it takes to show it and the way a TAKE / PRV push / clear / FTB changes it. `update()` is fed the
## live entry (+ how the simulated server got there: demo_scene.gd `bus_fx`), `frame(now)` answers what is on the
## screen at time `now` as draw items, bottom → top:
##   {layer, media, kind (still | video | stream), dst (bus px, transition offset applied), src (image px), uv (src as
##    fractions of the still), alpha (layer opacity × transition), rotation (deg), clip (bus px, wipe; empty = none),
##    t (s since the layer started), pos (playhead), dur (s), loop, ended, stream (res:// path or ""), seed, key}
## Geometry is look_thumb_math.gd's (the look cards' placement), so the picture agrees with the cards. A layer that is the
## same source on the same layer number in the outgoing and the incoming look is left alone (layerVisuallyEqual: no
## PLAY, no tween). An edit of the look that is already on the bus (the Inspector's PRV push) applies at once.

const TM := preload("res://features/live/look_thumb_math.gd")
const Tr := preload("res://core/demo/demo_transition.gd")
const Media := preload("res://core/demo/demo_media.gd")

var channel := 0
var size := Vector2i(960, 540)
var fps := 25.0
var media_info: Callable = func(_id: String) -> Dictionary: return {}  # media id → {type, durationMs}
var look := {}
var look_id := ""
var out_look := {}
var _t0 := {}  # layer key → when it started (s)
var _out_t0 := {}
var _key := ""
var _seen := false
var _tr := {"type": "CUT", "tween": "linear", "start": 0.0, "dur": 0.0}


func _init(ch := 0) -> void:
	channel = ch


static func entry_key(e: Dictionary) -> String:
	return "" if e.is_empty() else "%s@%s" % [str(e.get("sceneId", "")), str(e.get("updatedAt", ""))]


static func layer_key(l: Dictionary) -> String:
	var src: Variant = l.get("source")
	return "%d|%s" % [int(l.get("layerNumber", 0)), str(src.get("value", "")) if src is Dictionary else ""]


## A new live entry ({} = the bus is empty) and the server-side facts about how it came ({kind, transition, fps}).
func update(entry: Dictionary, fx: Dictionary, now: float) -> void:
	var key := entry_key(entry)
	if _seen and key == _key:
		return
	_key = key
	if fx.has("fps") and float(fx.fps) > 0.0:
		fps = float(fx.fps)
	var at := minf(float(fx.get("at", now)), now)  # when the server did it: a change noticed late is already part-way
	var scene: Dictionary = entry.get("scene") if entry.get("scene") is Dictionary else {}
	if not _seen:  # the first sight is the show as it stands: no fade
		_seen = true
		look = scene
		look_id = str(entry.get("sceneId", ""))
		_sync_t0(now)
		return
	if scene.is_empty():  # clear / FTB: the look fades out
		if look.is_empty():
			return
		_begin_out(now)
		look = {}
		look_id = ""
		_tr = {"type": "MIX", "tween": "linear", "start": at, "dur": Tr.CLEAR_SECONDS}
	elif str(entry.get("sceneId", "")) == look_id:  # an edit of the look on the bus
		look = scene
		_sync_t0(now)
	else:  # another look: TAKE / PRV push
		var tr: Variant = fx.get("transition") if fx.get("transition") is Dictionary else scene.get("defaultTransition")
		_begin_out(now)
		look = scene
		look_id = str(entry.get("sceneId", ""))
		for k in _out_t0:  # an unchanged layer keeps playing
			if _has_key(look, k):
				_t0[k] = _out_t0[k]
		_sync_t0(at)
		_tr = {"type": Tr.base_type(tr), "tween": str((tr as Dictionary).get("tween", "linear")) if tr is Dictionary else "linear",
			"start": at, "dur": Tr.seconds(tr, fps)}
	if _progress(now) >= 1.0:
		out_look = {}


func _begin_out(_now: float) -> void:  # a take on a take: the half-faded look just goes
	out_look = look
	_out_t0 = _t0.duplicate()
	_t0 = {}


func _sync_t0(now: float) -> void:
	var keep := {}
	for l in TM.sorted_layers(look):
		var k := layer_key(l)
		keep[k] = _t0.get(k, now)
	_t0 = keep


## One settled look at `size` as draw items (no transition) — the still the look cards and the CPU reader draw.
static func settled_items(lk: Dictionary, sz: Vector2i, info := Callable()) -> Array:
	var b := new()
	b.size = sz
	if info.is_valid():
		b.media_info = info
	b.update({"sceneId": "look", "scene": lk, "updatedAt": 0}, {}, 0.0)
	return b.frame(0.0)


static func _has_key(lk: Dictionary, k: String) -> bool:
	for l in TM.sorted_layers(lk):
		if layer_key(l) == k:
			return true
	return false


## 0 → 1 over the transition (1 when none runs).
func _progress(now: float) -> float:
	var d := float(_tr.dur)
	return 1.0 if d <= 0.0 else clampf((now - float(_tr.start)) / d, 0.0, 1.0)


func last_key() -> String:
	return _key


func progress(now: float) -> float:
	return _progress(now)


func in_transition(now: float) -> bool:
	return _progress(now) < 1.0


func frame(now: float) -> Array:
	var p := _progress(now)
	if p >= 1.0:
		out_look = {}
	var e := Tr.ease(str(_tr.tween), p)
	var type := str(_tr.type)
	var sz := Vector2(size)
	var items := []
	var in_layers := {}
	for l in TM.sorted_layers(look):
		in_layers[int(l.get("layerNumber", 0))] = true
	for l in TM.sorted_layers(out_look):
		var k := layer_key(l)
		if _t0.has(k):
			continue  # same layer, same source: drawn once, by the incoming look
		_add(items, l, now - float(_out_t0.get(k, now)), float(_out_t0.get(k, now)),
			Tr.outgoing(type, e, sz, in_layers.has(int(l.get("layerNumber", 0)))))
	for l in TM.sorted_layers(look):
		var k := layer_key(l)
		var fx := {"alpha": 1.0, "offset": Vector2.ZERO, "clip": Rect2()}
		if p < 1.0 and not (_out_t0.has(k) and _t0.get(k) == _out_t0.get(k)):
			fx = Tr.incoming(type, e, sz)
		_add(items, l, now - float(_t0.get(k, now)), float(_t0.get(k, now)), fx)
	return items


func _add(items: Array, l: Dictionary, t: float, t0: float, fx: Dictionary) -> void:
	var src: Variant = l.get("source")
	var st := str(src.get("type", "")).to_lower() if src is Dictionary else ""
	if st != "media" and st != "file":
		return
	var media := str(src.get("value", ""))
	var opacity := clampf(float(l.opacity) if l.get("opacity") != null else 1.0, 0.0, 1.0)
	var alpha := opacity * float(fx.alpha)
	var img := Media.thumb_image(media)
	if alpha <= 0.001 or img == null:
		return
	var at := TM.placement(l, Vector2(size), Vector2(img.get_size()))
	if at.is_empty():
		return
	var info: Dictionary = media_info.call(media)
	var stream := Media.stream_for(media)
	var dur := float(info.get("durationMs", 0)) / 1000.0
	var loop: bool = l.get("loop") == true
	var kind := "stream" if stream != "" else ("video" if str(info.get("type", "")) == "MOVIE" else "still")
	var d: Rect2 = at.dst
	d.position += fx.offset
	var s_rect: Rect2 = at.src
	var isz := Vector2(img.get_size())
	var t_play := maxf(t, 0.0)
	items.append({"layer": int(l.get("layerNumber", 0)), "media": media, "kind": kind, "dst": d, "src": s_rect, "img": img,
		"uv": Rect2(s_rect.position / isz, s_rect.size / isz), "alpha": alpha, "rotation": float(l.get("rotation", 0)),
		"clip": fx.clip, "t": t_play, "pos": (fmod(t_play, dur) if loop else minf(t_play, dur)) if dur > 0.0 else t_play,
		"dur": dur, "loop": loop, "ended": dur > 0.0 and not loop and t_play >= dur, "stream": stream,
		"seed": float(media.hash() % 1000) / 1000.0, "key": "%d|%s|%d" % [channel, layer_key(l), roundi(t0 * 1000.0)]})
