extends RefCounted
## WO-901 — core/bounce_model.gd (the lockscreen's bouncing character): size / speed clamps, aspect fit, wall bounces,
## the eye-frame pick, and the lockscreen prefs (style / size / speed) in ui.cfg.

const B := preload("res://core/bounce_model.gd")
const L := preload("res://core/lock_model.gd")
const BounceCharacter := preload("res://app/bounce_character.gd")
var t


func test_clamps() -> void:
	t.eq(B.clamp_size(26), 26, "in range")
	t.eq(B.clamp_size(1), B.SIZE_MIN, "low")
	t.eq(B.clamp_size(500), B.SIZE_MAX, "high")
	t.eq(B.clamp_size("x"), B.SIZE_DEFAULT, "junk")
	t.eq(B.clamp_speed(0.0), B.SPEED_MIN, "slow")
	t.eq(B.clamp_speed(9.0), B.SPEED_MAX, "fast")
	t.eq(B.clamp_speed(null), B.SPEED_DEFAULT, "junk")
	t.eq(B.clamp_speed(1.0), 1.0, "default")


func test_box_and_fit() -> void:
	t.eq(B.box_px(Vector2(1728, 960), 26), 250.0, "the test pattern's 26 % of 960")
	t.eq(B.box_px(Vector2(720, 576), 26), 150.0, "scales with the shorter side")
	t.eq(B.box_px(Vector2(100, 100), 10), 40.0, "never below 40 px")
	t.eq(B.fit(200.0, Vector2(512, 666)), Vector2(200.0 * 512.0 / 666.0, 200.0), "portrait: height = box")
	t.eq(B.fit(200.0, Vector2(400, 100)), Vector2(200.0, 50.0), "landscape: width = box")
	t.eq(B.fit(200.0, Vector2.ZERO), Vector2(200, 200), "no texture")


func test_start_is_inside_and_moving() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for i in 20:
		var s := B.start(Vector2(1920, 1080), Vector2(200, 260), 280.0, rng)
		t.ok(s.pos.x >= 0.0 and s.pos.x <= 1720.0 and s.pos.y >= 0.0 and s.pos.y <= 820.0, "start inside the screen")
		t.ok(absf(s.vel.x) >= 0.8 * 280.0 - 0.01 and absf(s.vel.x) <= 1.2 * 280.0 + 0.01, "speed within jitter")
		t.ok(absf(s.vel.y) >= 0.8 * 280.0 - 0.01 and absf(s.vel.y) <= 1.2 * 280.0 + 0.01, "speed within jitter y")


func test_step_free_flight() -> void:
	var r := B.step(Vector2(100, 100), Vector2(50, -20), 0.05, Vector2(1000, 800), Vector2(100, 100))
	t.eq(r.pos, Vector2(102.5, 99), "moved by vel * dt")
	t.eq(r.vel, Vector2(50, -20), "unchanged")
	t.ok(not r.hit, "no wall")


func test_step_bounces_on_the_drawn_rect() -> void:
	var r := B.step(Vector2(895, 100), Vector2(100, 0), 0.1, Vector2(1000, 800), Vector2(100, 100))
	t.eq(r.pos.x, 900.0, "stops flush with the right wall (drawn right edge = 1000)")
	t.ok(r.vel.x < 0.0 and r.hit, "reversed, a hit")
	r = B.step(Vector2(3, 100), Vector2(-100, 0), 0.1, Vector2(1000, 800), Vector2(100, 100))
	t.eq(r.pos.x, 0.0, "left wall")
	t.ok(r.vel.x > 0.0 and r.hit, "reversed, a hit")
	r = B.step(Vector2(100, 3), Vector2(0, -90), 0.1, Vector2(1000, 800), Vector2(100, 100))
	t.ok(r.pos.y == 0.0 and r.vel.y > 0.0 and r.hit, "top wall")
	r = B.step(Vector2(100, 695), Vector2(0, 90), 0.1, Vector2(1000, 800), Vector2(100, 100))
	t.ok(r.pos.y == 700.0 and r.vel.y < 0.0 and r.hit, "bottom wall")
	r = B.step(Vector2(900, 700), Vector2(500, 500), 0.1, Vector2(1000, 800), Vector2(100, 100))
	t.ok(r.vel.x < 0.0 and r.vel.y < 0.0 and r.pos == Vector2(900, 700), "a corner reverses both")


func test_step_is_robust() -> void:
	var r := B.step(Vector2(10, 10), Vector2(100, 100), 5.0, Vector2(1000, 800), Vector2(100, 100))
	t.eq(r.pos, Vector2(20, 20), "a stalled frame is capped at 0.1 s")
	r = B.step(Vector2(10, 10), Vector2(100, 100), -1.0, Vector2(1000, 800), Vector2(100, 100))
	t.eq(r.pos, Vector2(10, 10), "negative dt = no move")
	r = B.step(Vector2(10, 10), Vector2(100, 100), 0.1, Vector2(50, 800), Vector2(100, 100))
	t.ok(r.pos.x == 0.0 and r.vel.x == 100.0, "wider than the screen: pinned, no bounce flicker")
	# a long run never leaves the screen
	var rng := RandomNumberGenerator.new()
	rng.seed = 3
	var s := B.start(Vector2(640, 480), Vector2(80, 104), 100.0, rng)
	var pos: Vector2 = s.pos
	var vel: Vector2 = s.vel
	var bounces := 0
	for i in 3000:
		var q := B.step(pos, vel, 1.0 / 60.0, Vector2(640, 480), Vector2(80, 104))
		pos = q.pos
		vel = q.vel
		bounces += 1 if q.hit else 0
		if pos.x < 0.0 or pos.y < 0.0 or pos.x + 80.0 > 640.0 + 0.001 or pos.y + 104.0 > 480.0 + 0.001:
			t.ok(false, "left the screen at step %d" % i)
			return
	t.ok(bounces > 5, "bounced %d times in 50 s" % bounces)


func test_next_frame_always_changes() -> void:
	for cur in 6:
		var seen := {}
		for k in 60:
			var n := B.next_frame(cur, 6, k / 60.0)
			t.ok(n != cur and n >= 0 and n < 6, "another frame")
			seen[n] = true
		t.eq(seen.size(), 5, "every other frame reachable from %d" % cur)
	t.eq(B.next_frame(0, 1, 0.5), 0, "a single frame")
	t.ok(B.next_frame(2, 6, 1.0) in range(6), "r = 1.0 stays valid")


func test_frames_exist_and_decode() -> void:
	t.eq(B.FRAMES.size(), 6, "three eye states in two colours")
	var tex := BounceCharacter.textures()
	t.eq(tex.size(), 6, "six textures")
	for i in tex.size():
		t.ok(tex[i] != null and tex[i].get_width() > 100, "%s decodes" % B.FRAMES[i])


func test_prefs_round_trip() -> void:
	var path := "user://test_bounce_prefs.cfg"
	DirAccess.remove_absolute(path)
	var d := L.load_prefs(path)
	t.eq([d.style, d.bounce_size, d.bounce_speed], ["plain", 26, 1.0], "defaults")
	L.save_pref("style", "bounce", path)
	L.save_pref("bounce_size", 40, path)
	L.save_pref("bounce_speed", 1.5, path)
	var p := L.load_prefs(path)
	t.eq([p.style, p.bounce_size, p.bounce_speed], ["bounce", 40, 1.5], "stored")
	t.eq(p.key, L.DEFAULT_KEY, "other prefs untouched")
	L.save_pref("style", "disco", path)
	L.save_pref("bounce_size", 9999, path)
	L.save_pref("bounce_speed", "fast", path)
	p = L.load_prefs(path)
	t.eq([p.style, p.bounce_size, p.bounce_speed], ["plain", B.SIZE_MAX, 1.0], "invalid values fall back or clamp")
	DirAccess.remove_absolute(path)
