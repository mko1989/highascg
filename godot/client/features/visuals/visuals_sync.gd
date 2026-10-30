extends RefCounted
## WO-866 — Sync: the drum pulses and the beat moved in time against the room sound. The chain to the LED wall (WS frames,
## render, shm ring, Caspar, LED processor) lags the room, so a visual can only land on a hit by firing early.
##   sync > 0 delays every bus by sync ms (the visuals run ahead of the sound, e.g. a slow PA delay line).
##   sync < 0 fires each drum's pulse early from its own steady period (the last hits' intervals agree within ±15 %); a drum
##   with no steady period plays unshifted. The beat bus shifts its phase either way (the beat tracker is periodic already).
## Hit times come from the WO-861 frames: `n` counts hits, `onset` is a 1 → 0 pulse over 150 ms, so a new hit happened
## (1 − onset) · 150 ms before the frame.

const DRUMS := ["kick", "snare", "hats"]
const PULSE_MS := 150.0
const MAX_MS := 300
const KEEP := 9  # hits kept per drum: 8 intervals
const STEADY := 0.15
const MIN_PERIOD := 80.0
const MAX_PERIOD := 2000.0
const AHEAD := 2  # predicted hits after the last real one before a stopped drum stops pulsing


static func new_state() -> Dictionary:
	return {"n": {}, "hits": {}, "frames": [], "beat": {}}


## A WS `audio_fft` frame arrived at `now_ms` (its buses already made by visuals_model.buses_of).
static func observe(state: Dictionary, frame: Variant, buses: Dictionary, now_ms: float) -> void:
	var p: Variant = frame.get("parts") if frame is Dictionary else null
	for d in DRUMS:
		var hit: Variant = p.get(d) if p is Dictionary else null
		if not hit is Dictionary:
			continue
		var n := int(_num(hit.get("n")))
		var hits: Array = state.hits.get(d, [])
		if n < int(state.n.get(d, n)):  # the engine reset
			hits = []
		elif n > int(state.n.get(d, n)):
			hits.append(now_ms - (1.0 - clampf(_num(hit.get("onset")), 0.0, 1.0)) * PULSE_MS)
			if hits.size() > KEEP:
				hits = hits.slice(hits.size() - KEEP)
		state.n[d] = n
		state.hits[d] = hits
	var beat: Variant = frame.get("beat") if frame is Dictionary else null
	state.beat = {"bpm": _num(beat.get("bpm")), "phase": _num(beat.get("phase")), "at": now_ms} if beat is Dictionary else {}
	state.frames.append([now_ms, buses])
	while state.frames.size() > 2 and state.frames[1][0] <= now_ms - MAX_MS - 100:
		state.frames.pop_front()


## The buses at `now_ms` with `sync_ms` applied. 0 returns `buses` untouched.
static func apply(state: Dictionary, buses: Dictionary, sync_ms: float, now_ms: float) -> Dictionary:
	var s := clampf(sync_ms, -MAX_MS, MAX_MS)
	if is_zero_approx(s):
		return buses
	var out := buses.duplicate()
	if s > 0.0:
		for f in state.frames:  # the levels as they were sync ms ago
			if f[0] <= now_ms - s:
				out = f[1].duplicate()
	for d in DRUMS:
		var hits: Array = state.hits.get(d, [])
		if s > 0.0:
			var v := 0.0
			for h in hits:
				v = maxf(v, pulse(now_ms - (h + s)))
			out[d] = v
		else:
			var per := period(hits)
			if per > 0.0:
				var k := mini(floori((now_ms - s - hits[-1]) / per), AHEAD)
				out[d] = pulse(now_ms - (hits[-1] + k * per + s))
	if float(state.beat.get("bpm", 0.0)) > 0.0:
		var ms: float = 60000.0 / state.beat.bpm
		var ph := fposmod(state.beat.phase + (now_ms - state.beat.at - s) / ms, 1.0)
		out["beat"] = clampf(1.0 - ph * 4.0, 0.0, 1.0)
	return out


## A drum's steady period in ms (median interval of the kept hits, 3 or more intervals, 3 in 4 within ±15 %), else 0.
static func period(hits: Array) -> float:
	if hits.size() < 4:
		return 0.0
	var iv := []
	for i in range(1, hits.size()):
		iv.append(hits[i] - hits[i - 1])
	var sorted := iv.duplicate()
	sorted.sort()
	var med: float = sorted[sorted.size() / 2]
	if med < MIN_PERIOD or med > MAX_PERIOD:
		return 0.0
	var good := 0
	for x in iv:
		if absf(x - med) <= med * STEADY:
			good += 1
	if good * 4 < iv.size() * 3 or absf(iv[-1] - med) > med * STEADY:
		return 0.0
	return med


## A hit's pulse `age_ms` after it fires: 1 → 0 over 150 ms, like the server's.
static func pulse(age_ms: float) -> float:
	return 1.0 - age_ms / PULSE_MS if age_ms >= 0.0 and age_ms < PULSE_MS else 0.0


static func _num(v: Variant) -> float:
	return float(v) if v is float or v is int else 0.0
