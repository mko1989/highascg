extends RefCounted
## WO-878 — when looks change by themselves, and when a picked one lands: on the next beat of the box's beat grid (WO-662 /
## WO-872 `beat.n`, which fires at predicted instants), every N bars of 4 beats to the next look, and on a drop (WO-861
## `parts.drop.n`). Without a locked tempo a picked look goes at once and the bars run on a 120 BPM clock. Pure: the tab calls
## step() once per frame with the newest WS frame's beat and drop count.

const BEATS_PER_BAR := 4
const FREE_BEAT_MS := 500.0
const BARS := [0, 4, 8, 16, 32]  # 0 = no timed changes


static func new_state() -> Dictionary:
	return {"n": -1, "beats": 0, "free_ms": 0.0, "drop_n": -1, "pending": -1}


## `project.visuals.auto` made safe: {bars (one of BARS), drops, quantise, playlist (WO-895: the visual playlist Auto runs
## instead of cycling the looks, visuals_playlist_ctl.gd; "" = none)}.
static func cfg_of(v: Variant) -> Dictionary:
	var d: Dictionary = v if v is Dictionary else {}
	var bars := int(d.get("bars", 0)) if d.get("bars") is float or d.get("bars") is int else 0
	return {"bars": bars if bars in BARS else 0, "drops": d.get("drops") == true, "quantise": d.get("quantise", true) != false,
		"playlist": str(d.playlist).left(64) if d.get("playlist") is String else ""}


static func locked(beat: Variant) -> bool:
	return beat is Dictionary and bool(beat.get("locked", false)) and float(beat.get("bpm", 0.0)) > 0.0


## A picked look: true = recall now; false = it waits in `pending` for the next beat.
static func pick(st: Dictionary, i: int, cfg: Dictionary, beat: Variant) -> bool:
	st.beats = 0
	if not cfg.quantise or not locked(beat):
		st.pending = -1
		return true
	st.pending = i
	return false


## One frame → the look to recall now, or -1. `current` = the look on the canvas (-1 none), `count` = how many are stored.
static func step(st: Dictionary, cfg: Dictionary, beat: Variant, drop_n: int, dt_ms: float, current: int, count: int) -> int:
	var tick := false
	var n := int(beat.get("n", -1)) if beat is Dictionary else -1
	if locked(beat):
		tick = st.n >= 0 and n != st.n
		st.free_ms = 0.0
	else:
		st.free_ms += dt_ms
		if st.free_ms >= FREE_BEAT_MS:
			st.free_ms -= FREE_BEAT_MS
			tick = true
	st.n = n
	if tick:
		st.beats += 1
	var out := -1
	if st.pending >= 0 and (tick or not locked(beat)):
		out = st.pending
		st.pending = -1
	var dropped: bool = st.drop_n >= 0 and drop_n > st.drop_n
	st.drop_n = drop_n
	if out < 0 and count > 1 and ((cfg.drops and dropped) or (cfg.bars > 0 and tick and st.beats >= cfg.bars * BEATS_PER_BAR)):
		out = (current + 1) % count
	if out >= 0:
		st.beats = 0
	return out


## Bars until the next timed change (for the page), or -1 when none is timed.
static func bars_left(st: Dictionary, cfg: Dictionary) -> int:
	if cfg.bars <= 0:
		return -1
	return ceili(float(cfg.bars * BEATS_PER_BAR - st.beats) / BEATS_PER_BAR)
