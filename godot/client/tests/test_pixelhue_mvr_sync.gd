extends RefCounted
## WO-1039 MVR — mvr_sync.gd (Studio's public/mvr-sync.js as a clock-fed state machine) and mvr_view.gd (canvas maths).

const Sync := preload("res://features/pixelhue/mvr_sync.gd")
const V := preload("res://features/pixelhue/mvr_view.gd")
var t


func test_edits_coalesce_for_100_ms() -> void:
	var s := Sync.new()
	t.ok(not s.is_due(0), "idle")
	s.schedule(1000)
	t.ok(not s.is_due(1050), "not yet")
	s.schedule(1060)  # another keystroke pushes the send back
	t.ok(not s.is_due(1100), "pushed back")
	t.ok(s.is_due(1160), "due 100 ms after the last edit")
	s.schedule(2000, 0)
	t.ok(s.is_due(2000), "delay 0 (drag end, undo) is due at once")


func test_one_request_in_flight() -> void:
	var s := Sync.new()
	s.schedule(0, 0)
	var epoch := s.begin([{"id": 1}], true)
	t.eq(epoch, 0, "sends")
	t.ok(s.running, "running")
	t.ok(not s.is_due(0), "begin clears the timer")
	s.schedule(10, 0)
	t.eq(s.begin([{"id": 2}], true), -1, "a second request waits for the first")
	t.ok(s.finish(epoch, ""), "the answer applies")
	t.ok(not s.running, "done")
	t.ok(s.follow_up(true, true), "edits made meanwhile go next")
	t.ok(not s.follow_up(false, true), "nothing left")
	t.ok(not s.follow_up(true, false), "blocked (dragging / busy)")


func test_nothing_to_send_or_blocked() -> void:
	var s := Sync.new()
	t.eq(s.begin([], true), -1, "no changes: no request")
	t.eq(s.begin([{"id": 1}], false), -1, "cannot send while dragging or busy")
	t.ok(not s.running, "not running")


func test_failure_stops_the_queue_until_retry() -> void:
	var s := Sync.new()
	var e := s.begin([{"id": 1}], true)
	t.ok(s.finish(e, "MVR windows cannot overlap. Move or resize the pending windows first."), "current")
	t.ok(s.has_error(), "failed")
	s.schedule(0, 0)
	t.ok(not s.is_due(10), "no automatic loop after a failure")
	t.eq(s.begin([{"id": 1}], true), -1, "nor a flush")
	t.ok(not s.follow_up(true, true), "nor a follow-up")
	s.retry()
	t.ok(not s.has_error(), "Retry save clears it")
	t.eq(s.begin([{"id": 1}], true), 0, "and sends again")


func test_reset_discards_older_answers() -> void:
	var s := Sync.new()
	var e := s.begin([{"id": 1}], true)
	s.reset()  # a new layout was adopted while the request ran
	t.ok(not s.finish(e, "late failure"), "the old answer is ignored")
	t.ok(not s.has_error(), "and cannot fail the new layout")
	t.eq(s.begin([{"id": 1}], true), 1, "a new generation")


func test_view_frame_letterboxes() -> void:
	var f := V.frame(Vector2(1000, 1000), 1920, 1080)
	t.eq(f.size.x, 984.0, "width-limited")
	t.eq(f.size.y, 984.0 * 1080.0 / 1920.0, "aspect kept")
	t.eq(f.position.y, (1000.0 - f.size.y) / 2.0, "centred")
	t.eq(V.frame(Vector2(10, 10), 1920, 1080), Rect2(), "too small")
	t.eq(V.frame(Vector2(500, 500), 0, 0), Rect2(), "no output")
	var g := Rect2(Vector2(8, 8), Vector2(960, 540))
	t.eq(V.to_output(g, 1920, Vector2(8 + 480, 8 + 270)), Vector2(960, 540), "control → output pixels")
	t.eq(V.window_rect(g, 1920, {"x": 192, "y": 108, "width": 384, "height": 216}), Rect2(Vector2(104, 62), Vector2(192, 108)), "output → control")


func test_view_hit_and_handles() -> void:
	var g := Rect2(Vector2.ZERO, Vector2(1920, 1080))
	var wins := [{"id": 1, "window": {"x": 0, "y": 0, "width": 400, "height": 300}}, {"id": 2, "window": {"x": 400, "y": 0, "width": 400, "height": 300}}]
	t.eq(V.hit(g, 1920, wins, -1, Vector2(100, 100)), 1, "inside window 1")
	t.eq(V.hit(g, 1920, wins, -1, Vector2(1000, 1000)), -1, "empty space")
	t.eq(V.hit(g, 1920, wins, 1, Vector2(404, 304)), 1, "the selected window's corner handle sticks out")
	t.eq(V.hit(g, 1920, wins, 2, Vector2(404, 304)), 2, "")
	t.eq(V.hit(g, 1920, wins, -1, Vector2(450, 350)), -1, "handles only on the selected window")
	var r := Rect2(Vector2(100, 100), Vector2(200, 100))
	t.eq(V.handle_at(r, Vector2(102, 98)), "nw", "nw")
	t.eq(V.handle_at(r, Vector2(300, 100)), "ne", "ne")
	t.eq(V.handle_at(r, Vector2(100, 200)), "sw", "sw")
	t.eq(V.handle_at(r, Vector2(305, 205)), "se", "se")
	t.eq(V.handle_at(r, Vector2(200, 150)), "", "middle moves")
