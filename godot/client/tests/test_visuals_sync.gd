extends RefCounted
## WO-866 Sync — hit times from the frames, delay, prediction from a steady period, unsteady drums unshifted, the beat
## phase shift, the slice field and the page's Audio controls.

const S := preload("res://features/visuals/visuals_sync.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const Page := preload("res://features/visuals/visuals_page.gd")
var t


## Kicks at `times` (ms) seen by 30 Hz frames; returns the state at `until`.
func _feed(times: Array, until: float, beat := {}) -> Dictionary:
	var st := S.new_state()
	var n := 0
	var f := 0.0
	while f <= until:
		while n < times.size() and times[n] <= f:
			n += 1
		var age: float = f - times[n - 1] if n > 0 else 1e9
		var frame := {"parts": {"kick": {"n": n, "onset": S.pulse(age), "level": 0.5}}}
		if not beat.is_empty():
			frame.beat = beat
		S.observe(st, frame, M.buses_of(frame), f)
		f += 1000.0 / 30.0
	return st


func test_hit_times_from_frames() -> void:
	var st := _feed([100.0, 600.0], 700.0)
	t.eq(st.hits.kick.size(), 2, "two hits")
	t.ok(absf(st.hits.kick[0] - 100.0) < 0.01 and absf(st.hits.kick[1] - 600.0) < 0.01, "back-dated by the pulse's age: %s" % [st.hits.kick])
	var reset := st.duplicate(true)
	S.observe(reset, {"parts": {"kick": {"n": 0, "onset": 0.0}}}, {}, 800.0)
	t.eq(reset.hits.kick, [], "n going back (engine reset) clears the hits")


func test_period() -> void:
	t.eq(S.period([0.0, 500.0, 1000.0, 1500.0]), 500.0, "steady 500 ms")
	t.eq(S.period([0.0, 500.0, 1000.0]), 0.0, "too few intervals")
	t.eq(S.period([0.0, 500.0, 800.0, 1500.0, 1700.0]), 0.0, "a syncopated pattern is not steady")
	t.eq(S.period([0.0, 500.0, 1010.0, 1490.0, 2000.0]), 510.0, "small jitter is steady (the upper median)")
	t.eq(S.period([0.0, 30.0, 60.0, 90.0]), 0.0, "faster than 80 ms is no period")


func test_zero_is_untouched() -> void:
	var st := _feed([0.0, 500.0, 1000.0], 1100.0)
	var b := {"kick": 0.4}
	t.ok(is_same(S.apply(st, b, 0.0, 1100.0), b), "sync 0 returns the same buses")


func test_delay() -> void:
	var st := _feed([1000.0], 1400.0)
	t.eq(S.apply(st, {"kick": 1.0}, 200.0, 1100.0).kick, 0.0, "the hit has not fired yet at +100 ms")
	t.ok(absf(S.apply(st, {"kick": 0.0}, 200.0, 1275.0).kick - 0.5) < 1e-6, "fires at +200 ms, half decayed 75 ms later")
	var lv := S.new_state()
	S.observe(lv, {}, {"bass": 0.1}, 0.0)
	S.observe(lv, {}, {"bass": 0.9}, 100.0)
	t.eq(S.apply(lv, {"bass": 0.9}, 80.0, 150.0).bass, 0.1, "levels come from the frame sync ms ago")
	t.eq(S.apply(lv, {"bass": 0.9}, 40.0, 150.0).bass, 0.9, "or the newest one old enough")


func test_predict() -> void:
	var hits := [0.0, 500.0, 1000.0, 1500.0, 2000.0]
	var st := _feed(hits, 2300.0)
	t.ok(absf(S.apply(st, {}, -100.0, 2400.0).kick - 1.0) < 1e-6, "steady 500 ms: the 2500 hit fires at 2400")
	t.eq(S.apply(st, {}, -100.0, 2390.0).kick, 0.0, "not before")
	t.eq(S.apply(st, {}, -100.0, 2300.0 + 3 * 500.0).kick, 0.0, "a drum that stops pulses at most 2 more times")
	var loose := _feed([0.0, 500.0, 800.0, 1500.0, 1700.0], 1800.0)
	t.ok(absf(S.apply(loose, {"kick": 0.7}, -100.0, 1800.0).kick - 0.7) < 1e-6, "no steady period: unshifted")


func test_beat_phase() -> void:
	var st := _feed([], 100.0, {"bpm": 120, "phase": 0.0})
	var at: float = st.beat.at
	t.ok(absf(S.apply(st, {}, -100.0, at).beat - 0.2) < 1e-6, "100 ms early at 120 bpm: phase 0.2 → 1 − 0.8")
	t.ok(absf(S.apply(st, {}, 100.0, at + 100.0).beat - 1.0) < 1e-6, "100 ms late: the beat lands 100 ms after the frame")
	# WO-872: the tempo is held through silence while the grid is dropped (phase 0) — no beat unless locked
	var off := _feed([], 100.0, {"bpm": 120, "phase": 0.0, "locked": false})
	t.eq(M.buses_of({"beat": {"bpm": 120, "phase": 0.0, "locked": false}}).beat, 0.0, "unlocked: the beat bus is 0")
	t.eq(S.apply(off, {"beat": 0.0}, -100.0, off.beat.at).get("beat"), 0.0, "unlocked: no shifted beat either")
	t.ok(absf(M.buses_of({"beat": {"bpm": 120, "phase": 0.1}}).beat - 0.6) < 1e-6, "no `locked` key (an older server): as before")


func test_slice_sync() -> void:
	t.eq(M.slice_of({}).sync, 0.0, "default 0")
	t.eq(M.slice_of({"visuals": {"sync": -999}}).sync, -300.0, "clamped")
	t.eq(M.slice_of({"visuals": {"sync": "x"}}).sync, 0.0, "junk → 0")


func test_page_audio_controls() -> void:
	var p: Page = Page.new()
	var got := []
	p.sensitivity_changed.connect(func(m: Dictionary) -> void: got.append(m))
	var syncs := []
	p.sync_changed.connect(func(ms: float) -> void: syncs.append(ms))
	p.set_sensitivity({"kick": 0.8, "snare": 0.25})
	t.eq(got, [], "loading the box's values emits nothing")
	t.eq(p._sens.kick.value, 0.8, "kick shown")
	t.eq(p._sens.hats.value, 0.5, "missing drum stays")
	p._sens.hats.value = 1.0
	p._emit_sens()  # Range signals only fire inside a tree; the runner has none
	t.eq(got, [{"kick": 0.8, "snare": 0.25, "hats": 1.0}], "a slider sends all three")
	var sl := M.slice_of({"visuals": {"sync": -120}})
	p.set_state(sl, {})
	t.eq(syncs, [], "set_state emits no sync")
	t.eq(p._sync_label.text, "-120 ms", "label shows the stored sync")
	p._on_sync(40.0)
	t.eq(syncs, [40.0], "a drag emits")
	p.free()
