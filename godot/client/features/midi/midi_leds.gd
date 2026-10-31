extends RefCounted
## WO-900 — APC40 mkII lights from the bindings, pure. In its power-on Generic mode the APC lights its own buttons (pads
## only while held); the host owns the lights in the Ableton modes, so "pad lights" first sends the Introduction sysex for
## Ableton Live mode (mode 1: the APC still draws its knob rings, every button is momentary), then Note On per light:
## the channel is the LED behaviour (0 = solid) for the RGB pads, the track for the track buttons, the velocity the colour
## (the RGB pads: an index into the APC's 128-colour palette) or 0 off / 1 on / 2 blink (single-colour LEDs). A knob's ring
## (and the APC's own value for it) is set by sending its CC back: the knob then turns on from the app's value.
## Source: Akai "APC40 Mk2 Communications Protocol" v1.2 (via github.com/hepp/akai-apc40-mk2 and Ableton's APC40_MkII script).

const OFF := 0
const AVAIL := 1  # a target that is there (a stored look, a layer)
const ON := 2  # the look on the canvas, a running Auto, a shown layer
const ALERT := 3  # blackout, a muted layer
const RGB_VEL := [0, 2, 21, 5]  # off, grey, green, red
const SYSEX_ABLETON := "F0 47 7F 29 60 00 04 41 08 02 01 F7"
const SYSEX_GENERIC := "F0 47 7F 29 60 00 04 40 08 02 01 F7"


static func rgb(num: int) -> bool:
	return num <= 39 or (num >= 82 and num <= 86)  # the clip grid and scene launch


static func ring(num: int) -> bool:
	return (num >= 48 and num <= 55) or (num >= 16 and num <= 23)  # track knobs, device knobs


## The lights the map asks for: {"status:num": value}. `state.call(target)` = OFF..ALERT for a button target, 0..127 (its
## value) for a range one. Only notes light; a CC lights only when it is an APC knob (its ring).
static func frame(map: Array, state: Callable) -> Dictionary:
	var out := {}
	for b in map:
		var num := int(b.num)
		if b.kind == "note":
			var s := clampi(int(state.call(b.target)), OFF, ALERT)
			var ch := 0 if rgb(num) else maxi(0, int(b.ch))
			out["%d:%d" % [0x90 | ch, num]] = RGB_VEL[s] if rgb(num) else [0, 0, 1, 2 if num == 52 else 1][s]
		elif b.kind == "cc" and ring(num):
			out["%d:%d" % [0xB0, num]] = clampi(int(state.call(b.target)), 0, 127)
	return out


## The bytes that turn `prev` into `next` (a light gone from `next` goes off) as amidi hex ("90 20 15 B0 30 40").
static func diff(prev: Dictionary, next: Dictionary) -> String:
	var out := PackedStringArray()
	for k in next:
		if prev.get(k) != next[k]:
			out.append(_bytes(k, next[k]))
	for k in prev:
		if not next.has(k) and (int(k.get_slice(":", 0)) & 0xF0) == 0x90:
			out.append(_bytes(k, 0))
	return " ".join(out)


static func _bytes(k: String, v: int) -> String:
	return "%02X %02X %02X" % [int(k.get_slice(":", 0)), int(k.get_slice(":", 1)), v]


## The first `amidi -l` port whose name holds `name` ("hw:2,0,0"), else "".
static func port_of(listing: String, name := "APC40") -> String:
	for line in listing.split("\n"):
		var f := line.strip_edges().split(" ", false)
		if f.size() >= 3 and f[1].begins_with("hw:") and line.findn(name) >= 0:
			return f[1]
	return ""
