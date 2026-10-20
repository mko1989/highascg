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
