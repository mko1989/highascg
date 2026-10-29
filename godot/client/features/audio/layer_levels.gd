extends RefCounted
## WO-800 — per-layer audio levels for the console's layer strips. The node's GET /api/osc/audio-layers
## ({channels: {"<ch>": {"<layer>": {nbChannels, levels: [{dBFS, peak}]}}}}, Caspar's per-layer sample peaks) is polled
## by audio_tab.gd while the tab is visible; this maps a strip row to its Caspar (channel, layer) and reads the level.
## Scale and ballistics are the channel meters' own (audio_meter_model.gd smooth / colour), not a new scale.

const AM := preload("res://features/audio/audio_meter_model.gd")

const PATH := "/api/osc/audio-layers"
const POLL_S := 0.2  # 5 Hz; the meter itself ticks at AM.TICK_S
const LOOK_MIN := 10  # look layers, bank A (src/engine/look-layer-ranges.js); bank B = +100
const LOOK_MAX := 99
const BANK_B_OFFSET := 100
## An entry older than this (response `updatedAt` − entry `updatedAt`, both the node's clock) counts as absent: the node
## drops a layer only after osc.staleTimeoutMs (5 s), so an ended clip would hold its last level that long. Web twin:
## client/lib/audio-layer-levels.js LAYER_LEVELS_FRESH_MS.
const FRESH_MS := 500


## The physical [channel, layer] a strip row meters, or [] (masters, rows without a layer). Scene look rows (the only
## rows with `audioScreens`) on a channel in bank "b" play on layer + 100; timeline / audio-only / live-audio slot /
## input rows sit on fixed layers. `banks` = scene.programLayerBankByChannel.
static func target(row: Dictionary, banks: Variant) -> Array:
	if row.get("isMaster", false) == true:
		return []
	var ch: Variant = row.get("ch")
	var ln: Variant = row.get("layer")
	if not AM._fin(ch) or not AM._fin(ln):
		return []
	var c := int(ch)
	var l := int(ln)
	if row.has("audioScreens") and l >= LOOK_MIN and l <= LOOK_MAX and banks is Dictionary and str(banks.get(str(c), "a")) == "b":
		l += BANK_B_OFFSET
	return [c, l]


## The response's entry for one layer, or null (no audio on that layer: Caspar stopped sending it — absent, or older
## than FRESH_MS against the response time).
static func entry(data: Variant, ch: int, ln: int) -> Variant:
	var e: Variant = AM._dict(AM._dict(AM._dict(data).get("channels")).get(str(ch))).get(str(ln))
	if not (e is Dictionary):
		return null
	var now: Variant = AM._dict(data).get("updatedAt")
	var at: Variant = e.get("updatedAt")
	if AM._fin(now) and AM._fin(at) and float(now) - float(at) > FRESH_MS:
		return null
	return e


## The layer's level: the loudest audio channel's dBFS (−99 when none is a number), like the channel bus bar's L/R max.
static func peak(e: Variant) -> float:
	var levels: Variant = AM._dict(e).get("levels")
	if not (levels is Array):
		return -99.0
	var n: int = levels.size()
	var nb: Variant = AM._dict(e).get("nbChannels")
	if AM._fin(nb) and int(nb) > 0:
		n = mini(n, int(nb))
	var best := -99.0
	for i in n:
		var d: Variant = AM._dict(levels[i]).get("dBFS")
		if AM._fin(d):
			best = maxf(best, float(d))
	return best


## {present, level} for a strip row: present = the layer is in the response (it carries audio right now).
static func read(data: Variant, row: Dictionary, banks: Variant) -> Dictionary:
	var t := target(row, banks)
	var e: Variant = entry(data, t[0], t[1]) if t.size() == 2 else null
	return {"present": e != null, "level": peak(e) if e != null else -99.0}


## One meter tick for the lane: [smoothed 0…1 or −1 = hidden, colour]. A layer with no audio shows nothing.
static func lane_tick(prev: float, r: Dictionary) -> Array:
	if r.get("present") != true:
		return [-1.0, ""]
	var level := float(r.get("level", -99.0))
	return [AM.smooth(maxf(prev, 0.0), level), AM.colour(level)]
