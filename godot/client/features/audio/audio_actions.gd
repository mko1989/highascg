extends RefCounted
## WO-604 — what a console gesture sends. Every Caspar effect is one server endpoint (WO-598 D): fader →
## POST /api/audio/volume (web postAudioVolume + volumeApiPayload), mute → POST /api/audio/mute, solo →
## POST /api/audio/solo {keys}. Strips no look owns carry their `key` so the server keeps the console state;
## look layers keep volume / muted on the look itself (web sceneState.patchLayer), timeline clips on the clip.

const MM := preload("res://features/live/mixer_math.gd")


## volumeApiPayload: linear gain clamped to 0…+6 dB, plus its dB.
static func volume_payload(gain: float) -> Dictionary:
	var v := clampf(gain if is_finite(gain) else 0.0, 0.0, MM.db_to_gain(MM.MAX_DB))
	return {"volume": v, "volumeDb": MM.gain_to_db(v)}


## Strips whose state lives in the server's mixer store (masters, inputs, live-audio slots, audio-only looks,
## timeline clips — the web's `!r.sceneId` branch). Look layers are stored on the look.
static func keyed(row: Dictionary) -> bool:
	var sid: Variant = row.get("sceneId")
	return sid == null or str(sid) == ""


static func volume_request(row: Dictionary, gain: float) -> Array:
	var b := {"channel": row.ch}
	if row.get("isMaster", false) == true:
		b["master"] = true
	else:
		b["layer"] = row.layer
	b.merge(volume_payload(gain))
	if keyed(row):
		b["key"] = row.key
	return ["POST", "/api/audio/volume", b]


## Unmute restores `gain` (the fader's current value), like the web's `nextMuted ? 0 : currentVol`.
static func mute_request(row: Dictionary, muted: bool, gain: float) -> Array:
	var b := {"channel": row.ch, "layer": row.layer, "muted": muted, "volume": volume_payload(gain).volume}
	if keyed(row):
		b["key"] = row.key
	return ["POST", "/api/audio/mute", b]


## audio-mixer-state.js toggleSolo: Ctrl adds / removes; a plain click solos only this strip (or clears it).
static func toggle_solo(current: Array, key: String, multi: bool) -> Array:
	var out := current.duplicate()
	var i := out.find(key)
	if multi:
		if i >= 0:
			out.remove_at(i)
		else:
			out.append(key)
	elif i >= 0 and out.size() == 1:
		out = []
	else:
		out = [key]
	return out


static func solo_request(keys: Array) -> Array:
	return ["POST", "/api/audio/solo", {"keys": keys}]


## sceneState.patchLayer for the console: the look's layer with this layerNumber takes `patch`. False when the
## look or the layer is gone (the look changed under the console).
static func patch_look_layer(project: Dictionary, scene_id: String, layer_number: Variant, patch: Dictionary) -> bool:
	var scenes: Variant = (project.get("scenes", {}) as Dictionary).get("scenes", []) if project.get("scenes") is Dictionary else []
	for s in scenes:
		if s is Dictionary and str(s.get("id", "")) == scene_id and s.get("layers") is Array:
			for l in s.layers:
				if l is Dictionary and l.get("layerNumber") != null and float(l.layerNumber) == float(layer_number):
					l.merge(patch, true)
					return true
	return false


## The web's input handler also writes the live copy (scene.live) so the meters and rows read the new value.
static func patch_live_layer(live: Variant, ch: Variant, layer_number: Variant, patch: Dictionary) -> void:
	if not (live is Dictionary):
		return
	var e: Variant = live.get(str(int(ch)) if ch is float or ch is int else str(ch))
	var layers: Variant = (e.get("scene", {}) as Dictionary).get("layers") if e is Dictionary and e.get("scene") is Dictionary else null
	if layers is Array:
		for l in layers:
			if l is Dictionary and l.get("layerNumber") != null and float(l.layerNumber) == float(layer_number):
				l.merge(patch, true)


## WO-604 slice 3 — live-input audio routing, composed on the server (src/audio/input-audio-routing.js). DeckLink /
## v4l2 inputs get the Ch route buttons and the audio-send policy; DeckLink / live-audio capture can be (re)started.
const ROUTED_KINDS := ["decklink", "v4l2"]
const START_KINDS := ["decklink", "live_audio"]
const SENDS := ["afv", "always", "never"]


static func routed(row: Dictionary) -> bool:
	return row.get("isLiveInput", false) == true and ROUTED_KINDS.has(str(row.get("inputKind", "")))


static func startable(row: Dictionary) -> bool:
	return row.get("isLiveInput", false) == true and START_KINDS.has(str(row.get("inputKind", ""))) and _slot(row) >= 1


static func _slot(row: Dictionary) -> int:
	var s: Variant = row.get("slot")
	return int(s) if (s is float or s is int) else (int(s) if str(s).is_valid_int() else 0)


## The server's routing entry for a strip ({send, targets, …}), matched by strip key; {} when the input has none.
static func routing_entry(snap: Variant, row: Dictionary) -> Dictionary:
	var inputs: Variant = snap.get("inputs") if snap is Dictionary else null
	if inputs is Array:
		for i in inputs:
			if i is Dictionary and str(i.get("key", "")) == str(row.get("key", "")):
				return i
	return {}


static func route_request(row: Dictionary, channel: int, on: bool) -> Array:
	return ["POST", "/api/audio/inputs/route", {"kind": str(row.inputKind), "slot": _slot(row), "channel": channel, "on": on}]


static func send_request(row: Dictionary, send: String) -> Array:
	return ["POST", "/api/audio/inputs/send", {"kind": str(row.inputKind), "slot": _slot(row), "send": send}]


static func start_request(row: Dictionary) -> Array:
	return ["POST", "/api/audio/inputs/start", {"kind": str(row.inputKind), "slot": _slot(row)}]


static func auto_mix_request(on: bool) -> Array:
	return ["POST", "/api/audio/auto-mix", {"on": on}]


## The ■ on an audio-only look strip: clears that look on its channel, the channel's video look untouched.
static func audio_only_stop_request(row: Dictionary) -> Array:
	return ["POST", "/api/scene/audio-only/stop", {"channel": int(row.ch)}]


## WO-604 — cross-screen audio (web WO-284 "Screens" row): a look layer's audio routed onto other program channels,
## composed on the server (src/api/routes-audio-cross-screen.js). Only look layers have it (the targets persist on
## the look layer as `audioScreens`).
static func cross_screen(row: Dictionary) -> bool:
	return row.get("sceneId") != null and str(row.get("sceneId")) != "" and row.get("isMaster", false) != true \
		and row.get("isLiveInput", false) != true


static func cross_screen_targets(row: Dictionary) -> Array:
	var out: Array = []
	for v in (row.get("audioScreens", []) if row.get("audioScreens") is Array else []):
		var n := int(v.get("channel", 0)) if v is Dictionary else (int(v) if (v is float or v is int or str(v).is_valid_int()) else 0)
		if n >= 1 and not out.has(n):
			out.append(n)
	out.sort()
	return out


static func cross_screen_plan_request(rows: Array) -> Array:
	var sources: Array = []
	for r in rows:
		if r is Dictionary and cross_screen(r):
			sources.append({"channel": int(r.ch), "layer": int(r.layer)})
	return ["POST", "/api/audio/cross-screen/plan", {"sources": sources}]


## The plan's buttons for one row ([] when the plan has no entry for its channel-layer yet).
static func cross_screen_buttons(plan: Variant, row: Dictionary) -> Array:
	var sources: Variant = plan.get("sources") if plan is Dictionary else null
	if sources is Array:
		for s in sources:
			if s is Dictionary and float(s.get("channel", 0)) == float(row.get("ch", -1)) and float(s.get("layer", 0)) == float(row.get("layer", -1)):
				return s.get("buttons", []) if s.get("buttons") is Array else []
	return []


static func cross_screen_request(row: Dictionary, target: int, on: bool) -> Array:
	return ["POST", "/api/audio/cross-screen",
		{"channel": int(row.ch), "layer": int(row.layer), "target": target, "enable": on, "current": cross_screen_targets(row)}]
