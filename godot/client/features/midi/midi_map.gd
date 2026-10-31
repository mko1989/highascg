extends RefCounted
## WO-900 — MIDI bindings, pure: which physical control (a source: a CC or a note, on one channel or any) drives which
## target id. A binding is {kind: "cc" | "note", ch: 0..15 or ANY, num: 0..127, target}. Targets are the Visuals' ids
## (visuals_midi.gd resolves them to controls): "layer:N" (opacity of layer N, 1 = the bottom one), "mute:N", "master",
## "fade", "param:<name>", "look:N", "burst", "tap", "audio" (the beat follows the music again), "blackout", "auto".
## The default map is the Akai APC40 mkII's power-on Generic mode (Akai "APC40 Mk2 Communications Protocol" v1.2;
## the faders and knobs send absolute 7-bit values there, no init sysex needed).

const ANY := -1
const RANGES := ["layer", "master", "fade", "param", "xfade"]  # continuous targets (a slider; picked up, midi_pickup.gd)
const BUTTONS := ["mute", "look", "burst", "tap", "audio", "blackout", "auto", "take", "cut"]  # take / cut / xfade: WO-908 A/B
const PARAM_LABELS := {"cam_yaw": "Camera yaw", "cam_pitch": "Camera pitch", "cam_zoom": "Camera zoom"}


## InputEventMIDI → {kind: "cc" | "note" | "off", ch, num, val}; {} for anything else (clock, sysex, pitch bend, …).
## A Note On with velocity 0 is a note off (running-status devices send it that way).
static func decode(e: InputEventMIDI) -> Dictionary:
	if e == null:
		return {}
	match e.message:
		MIDI_MESSAGE_CONTROL_CHANGE:
			return {"kind": "cc", "ch": e.channel, "num": e.controller_number, "val": e.controller_value}
		MIDI_MESSAGE_NOTE_ON:
			return {"kind": "note" if e.velocity > 0 else "off", "ch": e.channel, "num": e.pitch, "val": e.velocity}
		MIDI_MESSAGE_NOTE_OFF:
			return {"kind": "off", "ch": e.channel, "num": e.pitch, "val": 0}
	return {}


static func is_range(target: String) -> bool:
	return target.get_slice(":", 0) in RANGES


static func valid_target(target: String) -> bool:
	return target.get_slice(":", 0) in RANGES or target.get_slice(":", 0) in BUTTONS


## The binding a message drives: one on the message's own channel first, else one on ANY; {} = none.
static func find(map: Array, msg: Dictionary) -> Dictionary:
	var kind := "note" if msg.get("kind") == "off" else str(msg.get("kind", ""))
	var any := {}
	for b in map:
		if b.kind == kind and int(b.num) == int(msg.num):
			if int(b.ch) == int(msg.ch):
				return b
			if int(b.ch) == ANY and any.is_empty():
				any = b
	return any


## A stable key per source (pickup state, CC button edges): "cc:3:7", "note:*:32".
static func key(b: Dictionary) -> String:
	return "%s:%s:%d" % [b.kind, "*" if int(b.ch) == ANY else str(int(b.ch)), int(b.num)]


## Learn: `msg`'s control now drives `target` (on its own channel); whatever that control drove before is replaced.
static func learn(map: Array, msg: Dictionary, target: String) -> Array:
	var out := unbind_source(map, msg)
	out.append({"kind": "note" if msg.kind == "off" else msg.kind, "ch": int(msg.ch), "num": int(msg.num), "target": target})
	return out


## Every binding `msg`'s control matches (its channel or ANY) removed.
static func unbind_source(map: Array, msg: Dictionary) -> Array:
	var kind := "note" if msg.get("kind") == "off" else str(msg.get("kind", ""))
	return map.filter(func(b: Dictionary) -> bool:
		return not (b.kind == kind and int(b.num) == int(msg.num) and (int(b.ch) == int(msg.ch) or int(b.ch) == ANY)))


static func unbind_target(map: Array, target: String) -> Array:
	return map.filter(func(b: Dictionary) -> bool: return b.target != target)


## A stored map made safe: known kinds and targets, numbers in range, one binding per source (the last one wins).
static func normalize(v: Variant) -> Array:
	var out := []
	if not v is Array:
		return out
	for b in v:
		if not b is Dictionary or not str(b.get("kind", "")) in ["cc", "note"] or not valid_target(str(b.get("target", ""))):
			continue
		if not (b.get("num") is int or b.get("num") is float) or not (b.get("ch") is int or b.get("ch") is float):
			continue
		var n := {"kind": str(b.kind), "ch": clampi(int(b.ch), ANY, 15), "num": clampi(int(b.num), 0, 127), "target": str(b.target)}
		out = out.filter(func(o: Dictionary) -> bool: return key(o) != key(n))
		out.append(n)
	return out


## "Layer 3 opacity", "Master", "Pulse", "Look 4", …
static func target_label(target: String) -> String:
	var p := target.split(":")
	match p[0]:
		"layer":
			return "Layer %s opacity" % p[1]
		"mute":
			return "Layer %s mute" % p[1]
		"look":
			return "Look %s" % p[1]
		"param":
			return PARAM_LABELS.get(p[1], p[1].capitalize()) if p.size() > 1 else target
		"audio":
			return "Tempo: Audio"
		"auto":
			return "Auto on/off"
		"xfade":
			return "A/B crossfader"
		"take":
			return "A/B AUTO"
		"cut":
			return "A/B CUT"
	return target.capitalize()


## What a control is called: the APC40 mkII's own names when `apc`, else "CC 7 · ch 1" / "Note 36 · ch 10".
static func describe(msg: Dictionary, apc := false) -> String:
	var kind := "note" if msg.get("kind") == "off" else str(msg.get("kind", ""))
	var ch := int(msg.get("ch", 0))
	var num := int(msg.get("num", 0))
	var named := apc_name(kind, ch, num) if apc else ""
	if named != "":
		return named
	return "%s %d%s" % ["CC" if kind == "cc" else "Note", num, "" if ch == ANY else " · ch %d" % (ch + 1)]


## The APC40 mkII's control names ("" = not one of its controls). Track controls carry the track in the channel.
static func apc_name(kind: String, ch: int, num: int) -> String:
	var track := ch + 1
	if kind == "cc":
		if num == 7:
			return "Fader %d" % track
		if num >= 48 and num <= 55:
			return "Knob %d" % (num - 47)
		if num >= 16 and num <= 23:
			return "Device knob %d" % (num - 15)
		return {14: "Master fader", 15: "Crossfader", 47: "Cue level", 13: "Tempo knob"}.get(num, "")
	if num <= 39:
		return "Pad %d·%d" % [5 - floori(num / 8.0), num % 8 + 1]  # row from the top · column
	if num >= 82 and num <= 86:
		return "Scene %d" % (num - 81)
	if (num >= 48 and num <= 52) or num == 66:
		return "%s %d" % [{48: "Arm", 49: "Solo", 50: "Activator", 51: "Select", 52: "Clip stop", 66: "A/B"}[num], track]
	return {81: "Stop all clips", 99: "Tap tempo", 98: "Shift", 91: "Play", 93: "Record", 102: "Session", 90: "Metronome",
		100: "Nudge −", 101: "Nudge +", 80: "Master", 87: "Pan", 88: "Sends", 89: "User", 94: "Bank ▲", 95: "Bank ▼",
		96: "Bank ▶", 97: "Bank ◀", 103: "Bank"}.get(num, "")


## The APC40 mkII default map (WO-900 table). Controls that carry no track are bound on ANY channel: the device knobs follow
## the selected track's channel in Generic mode and are on channel 1 in the Ableton modes.
static func apc40() -> Array:
	var m := []
	for t in 8:
		m.append({"kind": "cc", "ch": t, "num": 7, "target": "layer:%d" % (t + 1)})  # track faders → layer opacity
		m.append({"kind": "note", "ch": t, "num": 52, "target": "mute:%d" % (t + 1)})  # clip stop → layer mute
	m.append({"kind": "cc", "ch": ANY, "num": 14, "target": "master"})
	var knobs := ["pulse", "spin", "hue", "glow", "flash", "speed", "amount"]
	for i in knobs.size():
		m.append({"kind": "cc", "ch": ANY, "num": 48 + i, "target": "param:" + knobs[i]})  # track knobs 1–7
	m.append({"kind": "cc", "ch": ANY, "num": 55, "target": "fade"})  # track knob 8
	for i in 3:
		m.append({"kind": "cc", "ch": ANY, "num": 16 + i, "target": "param:" + ["cam_yaw", "cam_pitch", "cam_zoom"][i]})
	for i in 12:  # clip grid, top row = looks 1–8, then the second row's first four = looks 9–12
		m.append({"kind": "note", "ch": ANY, "num": 32 + i if i < 8 else 24 + i - 8, "target": "look:%d" % (i + 1)})
	m.append({"kind": "note", "ch": ANY, "num": 82, "target": "burst"})  # scene launch 1
	m.append({"kind": "note", "ch": ANY, "num": 83, "target": "auto"})  # scene launch 2
	m.append({"kind": "note", "ch": ANY, "num": 84, "target": "audio"})  # scene launch 3
	m.append({"kind": "note", "ch": ANY, "num": 99, "target": "tap"})  # tap tempo
	m.append({"kind": "note", "ch": ANY, "num": 81, "target": "blackout"})  # stop all clips
	m.append({"kind": "cc", "ch": ANY, "num": 15, "target": "xfade"})  # WO-908: the crossfader → A/B banks
	return m
