extends RefCounted
## WO-806 — the audio console's one client, shared by the Audio tab (WO-604) and the Program audio dock in the
## Inspector footer: the server reads (GET /api/audio/mixer, /api/audio/live-inputs, /api/audio/inputs/routing + the
## `audioMixer` / `audioInputRouting` changes), the strip list (audio_rows.gd) and every write a strip gesture makes
## (audio_actions.gd requests: fader debounced while it moves and sent at once on release, mute with the current gain,
## solo set, live-input Ch routes / send / START, audio-only STOP, cross-screen Screens). Look layers also keep volume /
## muted / audioScreens on the look (web sceneState.patchLayer). Moved out of audio_tab.gd so the two surfaces can never
## drift: a move on one reaches the other through the server's `audioMixer` change / the look.
## A strip is any Control with `row`, `gain()`, `muted()`, `set_solo()` and (some of) audio_strip.gd's signals.

const AR := preload("res://features/audio/audio_rows.gd")
const AA := preload("res://features/audio/audio_actions.gd")
const DEBOUNCE_MS := 80

signal changed  ## the strip values may have changed: the surface re-reads rows (refresh)
signal status(text: String)  ## "" after a good write, the error after a failed one

var mixer := {}
var routing := {}
var live_inputs: Variant = null
var xplan := {}  # cross-screen plan for the current strips
var strips := {}  # key → strip
var metas := {}  # key → meter meta
var _pending := {}  # key → [due_ms, gain]


## The three server reads (a surface calls this when it is shown).
func fetch() -> void:
	var m: Dictionary = await _g("Api").get_json("/api/audio/mixer")
	if m.ok and m.data is Dictionary:
		mixer = m.data
	var li: Dictionary = await _g("Api").get_json("/api/audio/live-inputs")
	if li.ok:
		live_inputs = li.data
	var ro: Dictionary = await _g("Api").get_json("/api/audio/inputs/routing")
	if ro.ok and ro.data is Dictionary:
		routing = ro.data
	changed.emit()


## A Store change: keeps the server state; true when the surface should refresh.
func on_store(path: String, value: Variant) -> bool:
	if path == "audioMixer" and value is Dictionary:
		mixer = value
	if path == "audioInputRouting" and value is Dictionary:
		routing = value
	return path in ["*", "channelMap", "audioMixer", "audioInputRouting", "timeline.playback"] or path.begins_with("scene")


func state() -> Dictionary:
	var tl: Variant = _g("Store").project.get("timelines")
	return {"channelMap": _d(_g("Store").get_value("channelMap")), "live": _d(_g("Store").get_value("scene.live")),
		"liveAudioOnly": _d(_g("Store").get_value("scene.liveAudioOnly")), "playback": _g("Store").get_value("timeline.playback"),
		"timelines": tl.get("timelines", []) if tl is Dictionary else [], "mixer": mixer, "liveInputs": live_inputs,
		"casparServer": _d(_g("Settings").get_setting("casparServer", {}))}


## Live inputs, then masters and layers per program channel (the console's and the dock's list).
func rows(st: Dictionary) -> Array:
	return AR.input_rows(st.channelMap, mixer) + AR.program_rows(st)


## An autoload, named at runtime: the unit-test runner compiles this file without them (tests/test_audio_dock.gd).
static func _g(name: String) -> Variant:
	return (Engine.get_main_loop() as SceneTree).root.get_node_or_null(name)


static func _d(v: Variant) -> Dictionary:
	return v if v is Dictionary else {}


static func programs(cm: Dictionary) -> Array:
	return cm.get("programChannels", []) if cm.get("programChannels") is Array and not cm.programChannels.is_empty() else [1]


func solos() -> Array:
	return mixer.get("solos", []) if mixer.get("solos") is Array else []


func pending(key: String) -> bool:
	return _pending.has(key)


## Forget the strips (the surface rebuilds them).
func clear() -> void:
	strips.clear()
	metas.clear()


## Register a strip and wire whichever of the console gestures it has.
func bind(s: Variant, r: Dictionary) -> void:
	var key: String = r.key
	strips[key] = s
	metas[key] = AR.meter_meta(r)
	s.gain_changed.connect(func(g: float, final: bool) -> void: gain(key, g, final))
	s.mute_pressed.connect(func() -> void: mute(key))
	if s.has_signal("solo_pressed"):
		s.solo_pressed.connect(func(multi: bool) -> void: solo(key, multi))
	if s.has_signal("screen_toggled"):
		s.screen_toggled.connect(func(ch: int, on: bool) -> void: screen(key, ch, on))
	if s.has_signal("route_toggled"):
		s.route_toggled.connect(func(ch: int, on: bool) -> void: _after(await send(AA.route_request(s.row, ch, on))))
	if s.has_signal("send_selected"):
		s.send_selected.connect(func(v: String) -> void: _after(await send(AA.send_request(s.row, v))))
	if s.has_signal("stop_pressed"):
		s.stop_pressed.connect(func() -> void: send(AA.audio_only_stop_request(s.row)))
	if s.has_signal("start_pressed"):
		s.start_pressed.connect(func() -> void:
			var res := await send(AA.start_request(s.row))
			if res.ok:
				status.emit("%s capture started (%d route(s) restored)." % [str(s.row.label), int(_d(res.get("data")).get("routesRestored", 0))]))


## Fader: the look's own layer takes the value (web patchLayer on change); the server gets a debounced write while
## the fader moves and an immediate one on release.
func gain(key: String, g: float, final: bool) -> void:
	var s: Variant = strips.get(key)
	if s == null:
		return
	var r: Dictionary = s.row
	if not AA.keyed(r):
		AA.patch_live_layer(_g("Store").get_value("scene.live"), r.ch, r.layer, {"volume": g})
		if final and AA.patch_look_layer(_g("Store").project, str(r.sceneId), r.layer, {"volume": g}):
			_g("ProjectSync").deck_changed()
			_g("ProjectSync").mark_dirty()
	if final:
		_pending.erase(key)
		send(AA.volume_request(r, g))
	else:
		_pending[key] = [Time.get_ticks_msec() + DEBOUNCE_MS, g]


## Sends the debounced fader writes that are due (the surface calls this every frame while shown).
func flush() -> void:
	var now := Time.get_ticks_msec()
	for k in _pending.keys():
		if now >= _pending[k][0]:
			var s: Variant = strips.get(k)
			var g: float = _pending[k][1]
			_pending.erase(k)
			if s:
				send(AA.volume_request(s.row, g))


func solo(key: String, multi: bool) -> void:
	var keys := AA.toggle_solo(solos(), key, multi)
	for k in strips:
		strips[k].set_solo(keys.has(k))
	var res := await send(AA.solo_request(keys))
	if not res.ok:
		changed.emit()  # back to the server's set


func mute(key: String) -> void:
	var s: Variant = strips.get(key)
	if s == null:
		return
	var r: Dictionary = s.row
	var next: bool = s.muted()
	if not AA.keyed(r):
		AA.patch_live_layer(_g("Store").get_value("scene.live"), r.ch, r.layer, {"muted": next})
		if AA.patch_look_layer(_g("Store").project, str(r.sceneId), r.layer, {"muted": next}):
			_g("ProjectSync").deck_changed()
			_g("ProjectSync").mark_dirty()
	metas[key] = AR.meter_meta(r.merged({"muted": next}, true))
	send(AA.mute_request(r, next, s.gain()))


func fetch_plan(list: Array) -> void:
	var req := AA.cross_screen_plan_request(list)
	if (req[2].sources as Array).is_empty():
		xplan = {}
		return
	var res: Dictionary = await _g("Api").post_json(req[1], req[2])
	xplan = _d(res.get("data")) if res.ok else {}
	changed.emit()


## A Screens toggle: on success the server's target list becomes the look layer's audioScreens (web patchLayer).
func screen(key: String, ch: int, on: bool) -> void:
	var s: Variant = strips.get(key)
	if s == null:
		return
	var r: Dictionary = s.row
	var res := await send(AA.cross_screen_request(r, ch, on))
	if res.ok:
		var targets: Array = _d(res.get("data")).get("targets", [])
		AA.patch_live_layer(_g("Store").get_value("scene.live"), r.ch, r.layer, {"audioScreens": targets})
		if AA.patch_look_layer(_g("Store").project, str(r.sceneId), r.layer, {"audioScreens": targets}):
			_g("ProjectSync").deck_changed()
			_g("ProjectSync").mark_dirty()
		r.audioScreens = targets
	elif str(_d(res.get("data")).get("reasonText", "")) != "":
		status.emit(str(res.data.reasonText))
	changed.emit()


## A refused routing call puts the toggles back on the server's state.
func _after(res: Dictionary) -> void:
	if not res.ok:
		changed.emit()


func send(req: Array) -> Dictionary:
	var res: Dictionary = await _g("Api").post_json(req[1], req[2])
	status.emit("" if res.ok else "%s failed: %s" % [req[1], res.get("error", res.get("status"))])
	return res
