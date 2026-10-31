extends RefCounted
## WO-909 — the APC40 mkII front panel as data, for the controller view (apc40_surface.gd): every control with its MIDI
## message and a place on a schematic of the unit (units ≈ one clip pad; the left block is the 8 tracks, the right block
## the device / transport / crossfader section). Note and CC numbers from Akai's "APC40 Mk2 Communications Protocol" v1.2
## (inbound tables p.30–35); per-track controls carry the track in the channel, the rest are on any channel.

const ANY := -1
const W := 21.0  # the panel's size in units
const H := 13.6
const COL := 1.5  # one track's width
const SHAPES := ["pad", "btn", "knob", "fader", "xfader", "encoder"]


static func _c(kind: String, ch: int, num: int, shape: String, rect: Rect2, name: String) -> Dictionary:
	return {"kind": kind, "ch": ch, "num": num, "shape": shape, "rect": rect, "name": name}


## Every control: {kind "cc" | "note", ch (track 0–7 or ANY), num, shape, rect (units), name}.
static func controls() -> Array:
	var out := []
	for t in 8:
		var x := t * COL
		out.append(_c("cc", ANY, 48 + t, "knob", Rect2(x + 0.25, 0.0, 1.0, 1.0), "Track knob %d" % (t + 1)))
		for r in 5:  # top row = notes 32–39, bottom row = 0–7
			out.append(_c("note", ANY, (4 - r) * 8 + t, "pad", Rect2(x + 0.1, 1.4 + r * 0.95, 1.3, 0.8), "Pad %d·%d" % [t + 1, r + 1]))
		out.append(_c("note", t, 52, "btn", Rect2(x + 0.1, 6.25, 1.3, 0.45), "Clip stop %d" % (t + 1)))
		out.append(_c("note", t, 51, "btn", Rect2(x + 0.1, 6.85, 1.3, 0.45), "Track select %d" % (t + 1)))
		for k in 4:
			var nb: int = [66, 50, 49, 48][k]
			var nm: String = ["A/B %d", "Activator %d", "Solo %d", "Rec arm %d"][k] % (t + 1)
			out.append(_c("note", t, nb, "btn", Rect2(x + 0.1 + k * 0.33, 7.45, 0.3, 0.35), nm))
		out.append(_c("cc", t, 7, "fader", Rect2(x + 0.45, 8.2, 0.6, 4.6), "Fader %d" % (t + 1)))
	for r in 5:
		out.append(_c("note", ANY, 82 + r, "pad", Rect2(12.15, 1.4 + r * 0.95, 1.0, 0.8), "Scene %d" % (r + 1)))
	out.append(_c("note", ANY, 81, "btn", Rect2(12.15, 6.25, 1.0, 0.45), "Stop all clips"))
	out.append(_c("note", ANY, 80, "btn", Rect2(12.15, 6.85, 1.0, 0.45), "Master select"))
	out.append(_c("cc", ANY, 14, "fader", Rect2(12.35, 8.2, 0.6, 4.6), "Master fader"))
	var rx := 14.2
	for i in 8:
		out.append(_c("cc", ANY, 16 + i, "knob", Rect2(rx + (i % 4) * 1.6 + 0.3, 0.0 + (i / 4) * 1.35, 1.0, 1.0), "Device knob %d" % (i + 1)))
	var dev := ["◀ Device", "Device ▶", "◀ Bank", "Bank ▶", "Dev on/off", "Dev lock", "Clip/Dev", "Detail"]
	for i in 8:
		out.append(_c("note", ANY, 58 + i, "btn", Rect2(rx + (i % 4) * 1.6 + 0.1, 2.85 + (i / 4) * 0.55, 1.4, 0.4), dev[i]))
	var row := [[87, "Pan"], [88, "Sends"], [89, "User"], [90, "Metronome"]]
	for i in row.size():
		out.append(_c("note", ANY, row[i][0], "btn", Rect2(rx + i * 1.6 + 0.1, 4.15, 1.4, 0.4), row[i][1]))
	row = [[91, "Play"], [92, "Stop"], [93, "Record"], [102, "Session rec"]]
	for i in row.size():
		out.append(_c("note", ANY, row[i][0], "btn", Rect2(rx + i * 1.6 + 0.1, 4.75, 1.4, 0.4), row[i][1]))
	out.append(_c("cc", ANY, 13, "encoder", Rect2(rx + 0.3, 5.5, 1.0, 1.0), "Tempo knob"))
	out.append(_c("cc", ANY, 47, "encoder", Rect2(rx + 1.9, 5.5, 1.0, 1.0), "Cue level"))
	out.append(_c("note", ANY, 99, "btn", Rect2(rx + 3.3, 5.6, 1.4, 0.4), "Tap tempo"))
	out.append(_c("note", ANY, 100, "btn", Rect2(rx + 4.9, 5.6, 0.65, 0.4), "Nudge −"))
	out.append(_c("note", ANY, 101, "btn", Rect2(rx + 5.6, 5.6, 0.65, 0.4), "Nudge +"))
	out.append(_c("note", ANY, 98, "btn", Rect2(rx + 3.3, 6.2, 1.4, 0.4), "Shift"))
	out.append(_c("note", ANY, 103, "btn", Rect2(rx + 4.9, 6.2, 1.35, 0.4), "Bank lock"))
	out.append(_c("note", ANY, 94, "btn", Rect2(rx + 2.6, 7.0, 1.0, 0.4), "▲"))
	out.append(_c("note", ANY, 97, "btn", Rect2(rx + 1.5, 7.5, 1.0, 0.4), "◀"))
	out.append(_c("note", ANY, 96, "btn", Rect2(rx + 3.7, 7.5, 1.0, 0.4), "▶"))
	out.append(_c("note", ANY, 95, "btn", Rect2(rx + 2.6, 8.0, 1.0, 0.4), "▼"))
	out.append(_c("cc", ANY, 15, "xfader", Rect2(rx + 0.2, 12.2, 6.2, 0.7), "Crossfader"))
	return out


## The control `msg` ({kind, ch, num}) came from, or {} (a Note Off finds its pad too).
static func find(list: Array, msg: Dictionary) -> Dictionary:
	var kind := "note" if msg.get("kind") == "off" else str(msg.get("kind", ""))
	for c in list:
		if c.kind == kind and int(c.num) == int(msg.get("num", -1)) and (int(c.ch) == ANY or int(c.ch) == int(msg.get("ch", -1))):
			return c
	return {}


## The message a control sends (ANY → channel 0, the APC's power-on bank).
static func msg_of(c: Dictionary) -> Dictionary:
	return {"kind": c.kind, "ch": maxi(0, int(c.ch)), "num": int(c.num)}


static func key(c: Dictionary) -> String:
	return "%s:%d:%d" % [c.kind, int(c.ch), int(c.num)]
