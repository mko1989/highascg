extends RefCounted
## WO-1106 B29 — the pads' library fill asks for each missing thumbnail once (a keyed look-up, not a scan of the render
## queue per row per 0.25 s tick), later ticks look only at the thumbnails still to come, and a thumbnail whose queue
## was dropped (the list rebuilt) is asked for again. visuals_thumbs.gd's own de-dupe is keyed too.

const Lib := preload("res://features/visuals/visuals_midi_library.gd")
const Thumbs := preload("res://features/visuals/visuals_thumbs.gd")
var t
var _mounted: Array[Node] = []


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		for n in _mounted:
			if is_instance_valid(n) and not n.is_queued_for_deletion():
				n.free()


class FakeThumbs:
	extends Node
	var failed := {}
	var cache := {}  # key → Texture2D
	var pending := {}
	var requests: Array = []
	var disk_lookups := 0

	func texture(key: String) -> Texture2D:
		disk_lookups += 1
		return cache.get(key)

	func request(key: String, _payload: Dictionary) -> void:
		requests.append(key)
		pending[key] = true

	func is_pending(key: String) -> bool:
		return pending.has(key)

	func is_cached(key: String) -> bool:
		return cache.has(key)


class FakePanel:
	extends Node
	var thumbs := FakeThumbs.new()
	var rows: Array = []

	func library_rows() -> Array:
		return rows


class FakeClips:
	extends RefCounted
	var banks: Array = []

	func set_auto_banks(b: Array) -> void:
		banks = b


class FakeMidi:
	extends Node
	var clips := FakeClips.new()
	var said: Array = []

	func _say(text: String) -> void:
		said.append(text)


static func _tex(c: Color) -> Texture2D:
	var img := Image.create(8, 8, false, Image.FORMAT_RGB8)
	img.fill(c)
	return ImageTexture.create_from_image(img)


func test_fill_asks_once_per_missing_thumbnail() -> void:
	Lib._filling_ms = -1
	var panel := FakePanel.new()
	panel.add_to_group("visuals_list")
	panel.add_child(panel.thumbs)
	var midi := FakeMidi.new()
	_mounted.append_array([panel, midi])
	t.root.add_child(panel)
	t.root.add_child(midi)
	for i in 200:
		var key := "th-%d" % (i % 150)  # 150 thumbnails, 50 rows share one
		panel.rows.append({"name": "v%d" % i, "thumb": key, "payload": {"type": "visual", "scene": "shader", "shader": "sh-%d" % i}})
		if i < 40:
			panel.thumbs.cache[key] = _tex(Color(1, 0, 0))
	panel.rows.append({"name": "game", "thumb": "", "payload": {"type": "visual", "scene": "game", "game": "/x.nes"}})
	var done := [false]
	var run := func() -> void:
		await Lib.fill(midi)
		done[0] = true
	run.call()
	await t.process_frame
	t.eq(panel.thumbs.requests.size(), 110, "each missing thumbnail asked for once (150 − 40 cached; shared ones once)")
	var lookups: int = panel.thumbs.disk_lookups
	t.eq(lookups, 150, "one look-up per distinct thumbnail, not per row per tick")
	for i in range(40, 100):
		panel.thumbs.cache["th-%d" % i] = _tex(Color(0, 0, 1))
		panel.thumbs.pending.erase("th-%d" % i)
	panel.thumbs.pending.erase("th-120")  # the list rebuilt and dropped its queue
	await t.create_timer(0.3).timeout
	t.eq(panel.thumbs.requests.size(), 111, "only the dropped one asked again")
	t.eq(panel.thumbs.disk_lookups, lookups, "the ticks never look on disk (is_cached / is_pending only)")
	t.ok(not done[0] and str(midi.said[-1]).contains("50 of 201 to go"), "still waiting for the rest: " + str(midi.said[-1]))
	for i in range(100, 150):
		panel.thumbs.cache["th-%d" % i] = _tex(Color(0, 1, 0))
	await t.create_timer(0.3).timeout
	t.ok(done[0], "done when every thumbnail is there")
	t.eq(midi.clips.banks.size(), 6, "201 rows on 6 banks")
	panel.free()
	midi.free()


func test_thumbs_queue_dedupe_is_keyed() -> void:
	var th: Node = Thumbs.new()  # not in the tree: nothing renders, the queue only fills
	th.request("a", {})
	th.request("a", {})
	th.request("b", {})
	t.eq([th._queue.size(), th.is_pending("a"), th.is_pending("c")], [2, true, false], "one queue entry per key")
	th.clear_queue()
	t.eq([th._queue.size(), th.is_pending("a")], [0, false], "a dropped queue forgets its keys")
	th.request("a", {})
	t.eq(th._queue.size(), 1, "so it can be asked again")
	th.free()
