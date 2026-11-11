extends RefCounted
## WO-1039 — features/pixelhue/programming_sync.gd, the live geometry queue (Studio program-sync.js): 40 ms pacing,
## one request in flight, newest pending window per layer, urgent sends, failure stops the queue until Retry,
## reset drops everything and ignores the old answer.

const Q := preload("res://features/pixelhue/programming_sync.gd")
var t


func _c(id: int, x: int) -> Dictionary:
	return {"action": "window", "screenId": 1, "id": id, "window": {"x": x, "y": 0, "width": 100, "height": 100}}


func test_first_send_is_immediate_then_paced() -> void:
	var q := Q.new()
	q.put(_c(5, 1))
	t.eq(q.wait_ms(1000), 0, "first update goes at once")
	var b := q.take(1000)
	t.eq(b.size(), 1, "one change")
	t.ok(q.saving, "in flight")
	q.put(_c(5, 2))
	t.eq(q.take(1001), [], "one request in flight")
	t.eq(q.wait_ms(1001), -1, "nothing to wait for while running")
	t.eq(q.complete(q.epoch, true), [], "superseded change is not accepted")
	t.ok(q.dirty, "newer position still pending")
	t.eq(q.wait_ms(1010), 30, "40 ms since the last send")
	t.eq(q.take(1010), [], "too early")
	var b2 := q.take(1040)
	t.eq(int(b2[0].window.x), 2, "newest position sent")
	t.eq(q.complete(q.epoch, true).size(), 1, "accepted")
	t.ok(not q.dirty and not q.saving, "drained")
	t.eq(q.status_text(), "Live · saved", "status")


func test_only_newest_per_layer_and_many_layers() -> void:
	var q := Q.new()
	for x in 10:
		q.put(_c(1, x))
	q.put(_c(2, 7))
	var b := q.take(0)
	t.eq(b.size(), 2, "one change per layer")
	t.eq(int(b[0].window.x), 9, "newest kept")
	t.eq(q.status_text(), "Sending…", "sending")


func test_urgent_skips_the_pace() -> void:
	var q := Q.new()
	q.put(_c(1, 1))
	q.take(100)
	q.complete(q.epoch, true)
	q.put(_c(1, 2), true)
	t.eq(q.wait_ms(110), 0, "release sends immediately")
	q.take(110)
	q.complete(q.epoch, true)
	q.put(_c(1, 3))
	q.force()
	t.eq(q.wait_ms(111), 0, "force (drain / numeric Enter)")


func test_failure_stops_until_retry() -> void:
	var q := Q.new()
	q.put(_c(1, 1))
	q.take(0)
	t.eq(q.complete(q.epoch, false, "Layer X must be 0–3008."), [], "nothing accepted")
	t.eq(q.failure, "Layer X must be 0–3008.", "Studio's words kept")
	t.eq(q.status_text(), "Not saved", "status")
	q.put(_c(1, 2))
	t.eq(q.take(1000), [], "stopped")
	q.retry()
	var b := q.take(1001)
	t.eq(int(b[0].window.x), 2, "retry sends the newest")
	t.eq(q.complete(q.epoch, true).size(), 1, "saved")


func test_can_send_blocks() -> void:
	var q := Q.new()
	q.put(_c(1, 1))
	t.eq(q.take(0, false), [], "busy / no state: wait")
	t.eq(q.wait_ms(0, false), -1, "no timer while blocked")
	t.eq(q.take(0, true).size(), 1, "resumes")


func test_reset_ignores_the_old_answer() -> void:
	var q := Q.new()
	q.put(_c(1, 1))
	var ep := q.epoch
	q.take(0)
	q.reset()
	t.ok(not q.dirty, "pending dropped")
	t.eq(q.complete(ep, false, "late failure"), [], "old answer ignored")
	t.eq(q.failure, "", "no failure from the old epoch")
	t.ok(not q.saving, "not running")


func test_keys_by_screen_and_layer() -> void:
	t.eq(Q.key_of({"screenId": 3.0, "id": 54657024.0}), "3:54657024", "float ids from JSON")
