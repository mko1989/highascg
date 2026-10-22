extends RefCounted
## WO-672 — live Verlet cable ropes: they hang below the straight line, stay plugged, fall asleep, wake on a move,
## and a step stays cheap enough for every frame. WO-674: 4 … 32 loops, and the weightless "chaos" tangle.

const Rope := preload("res://features/devices/cable_rope.gd")
const CableModel := preload("res://features/devices/cable_model.gd")
var t


func _settle(r: RefCounted, max_steps := 1500) -> int:
	for s in max_steps:
		if r.asleep():
			return s
		r.step()
	return max_steps


func test_run_hangs_in_a_curve_and_stays_plugged() -> void:
	var a := Vector2(100, 100)
	var b := Vector2(500, 100)
	var r := Rope.make(a, b, 0, 7)
	var steps := _settle(r)
	t.ok(r.asleep(), "settles and sleeps (%d steps)" % steps)
	var pts: PackedVector2Array = r.points()
	t.eq(pts[0], a, "plugged at the source port")
	t.eq(pts[pts.size() - 1], b, "plugged at the sink port")
	var mid := pts[pts.size() / 2]
	t.ok(mid.y > 100.0 + 16.0 + 30.0, "the middle hangs well below the boots (slack, not taut): y=%.1f" % mid.y)
	t.ok(absf(mid.x - 300.0) < 25.0, "and roughly in the middle: x=%.1f" % mid.x)


func test_coils_hang_below_the_run_and_swing() -> void:
	var r := Rope.make(Vector2(100, 100), Vector2(600, 120), 2, 11)
	t.eq(r.coils.size(), 2, "two loops on a long run")
	_settle(r)
	var c: Dictionary = r.coils[0]
	var top := Vector2(r.x[c.i], r.y[c.i])
	var lp: PackedVector2Array = Rope.loop_points(top, c)
	var lo := -INF
	for p in lp:
		lo = maxf(lo, p.y)
	t.ok(lo > top.y + c.r * 2.0, "the loop hangs below where it meets the cable (%.1f below)" % (lo - top.y))
	t.ok(absf(c.angle) < 0.05, "at rest it hangs straight down (angle %.3f)" % c.angle)
	t.eq(r.points().size(), r.x.size() + 2 * (Rope.LOOP_STEPS + 2), "both loops spliced into the drawn cable")
	r.pin(Vector2(100, 100), Vector2(800, 120))
	var peak := 0.0
	for i in 60:
		r.step()
		peak = maxf(peak, absf(r.coils[0].angle))
	t.ok(peak > 0.01, "a moved end swings the loops (peak %.3f rad)" % peak)
	_settle(r)
	t.ok(r.asleep(), "and they settle again")


func test_moving_an_end_wakes_and_resettles() -> void:
	var r := Rope.make(Vector2(100, 100), Vector2(500, 100), 1, 3)
	_settle(r)
	r.pin(Vector2(100, 100), Vector2(500, 100))
	t.ok(r.asleep(), "same ends: stays asleep")
	r.pin(Vector2(100, 100), Vector2(700, 150))
	t.ok(not r.asleep(), "a moved end wakes it")
	_settle(r)
	var pts: PackedVector2Array = r.points()
	t.eq(pts[pts.size() - 1], Vector2(700, 150), "follows the new port")
	t.ok(r.asleep(), "and settles again")


func test_step_cost() -> void:
	var r := Rope.make(Vector2(0, 0), Vector2(900, 200), 2, 5)
	var t0 := Time.get_ticks_usec()
	for i in 30:
		r.step()
	var us := (Time.get_ticks_usec() - t0) / 30.0
	print("[rope] %d points, %.0f µs per step" % [r.x.size(), us])
	t.ok(us < 4000.0, "one step of a long two-coil cable stays under 4 ms (%.0f µs)" % us)


func test_more_loops_capped_by_run_length() -> void:
	t.eq(CableModel.loop_specs(8, 600.0, 3).size(), 8, "8 loops on a 600 px run")
	t.eq(CableModel.loop_specs(32, 600.0, 3).size(), 600 / int(CableModel.LOOP_SPACING), "32 capped to one per 22 px")
	t.eq(CableModel.loop_specs(32, 900.0, 3).size(), 32, "32 on a long run")
	var ts := CableModel.loop_specs(16, 800.0, 9).map(func(s): return s.t)
	var sorted := ts.duplicate()
	sorted.sort()
	t.eq(ts, sorted, "loops in order along the run")
	var r := Rope.make(Vector2(100, 100), Vector2(700, 140), 8, 4)
	t.eq(r.coils.size(), 8, "the rope carries all eight")
	_settle(r)
	t.ok(r.asleep(), "and settles")


func test_chaos_is_a_weightless_tangle_between_the_ports() -> void:
	var a := Vector2(100, 100)
	var b := Vector2(700, 100)
	var r := Rope.make(a, b, CableModel.CHAOS, 13)
	t.ok(r.coils.size() >= 6, "chaos has loops (%d)" % r.coils.size())
	var before: PackedVector2Array = r.points()
	_settle(r)
	t.ok(r.asleep(), "settles and sleeps")
	var pts: PackedVector2Array = r.points()
	t.eq(pts[0], a, "plugged at the source port")
	t.eq(pts[pts.size() - 1], b, "plugged at the sink port")
	var lo := INF
	var hi := -INF
	var back := 0
	for i in range(2, r.x.size() - 2):
		lo = minf(lo, r.y[i])
		hi = maxf(hi, r.y[i])
		if r.x[i + 1] < r.x[i] - 0.5:
			back += 1
	var mid := (lo + hi) / 2.0
	t.ok(absf(mid - 116.0) < 40.0, "no gravity: the tangle stays centred on the boots (mid y %.1f)" % mid)
	t.ok(hi - lo > 40.0, "and spreads across the run (%.1f px)" % (hi - lo))
	t.ok(back > 3, "the run doubles back on itself (%d backward segments)" % back)
	t.ok(before[before.size() / 2].distance_to(pts[pts.size() / 2]) < 20.0, "holds the shape it was laid in")


func test_chaos_stays_off_controls() -> void:
	var r := Rope.make(Vector2(100, 100), Vector2(700, 100), CableModel.CHAOS, 13)
	var button := Rect2(300, 60, 120, 120)  # a control right across the run
	r.keepout = [button]
	_settle(r, 3000)
	var inside := 0
	for i in range(2, r.x.size() - 2):
		if button.has_point(Vector2(r.x[i], r.y[i])):
			inside += 1
	t.eq(inside, 0, "no point of the tangle rests on the control")
	for q in r.points():
		if button.has_point(q):
			inside += 1
	t.eq(inside, 0, "nor any drawn loop")
	t.ok(r.asleep(), "and it still settles")
