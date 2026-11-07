extends RefCounted
## Pending HTTP is seeded explicitly: no server, timers or GPU needed.
var Thumb: GDScript
const Math := preload("res://features/live/look_thumb_math.gd")
var t


func _init() -> void:
	# The unit SceneTree has no Api autoload. Keep the production script, replacing only transport.
	Thumb = GDScript.new()
	Thumb.source_code = FileAccess.get_file_as_string("res://features/live/look_thumb.gd").replace(
		"await Api.get_bytes(path)", '{"ok": false, "bytes": PackedByteArray()}')
	Thumb.reload()


func test_repeated_refresh_keeps_one_waiter_per_card() -> void:
	var source := {"type": "media", "value": "wo987-pending"}
	var path := Math.thumb_path(source, {})
	var look := {"layers": [{"source": source}, {"source": source}]}
	Thumb._waiters[path] = []
	var a: Control = Thumb.new()
	var b: Control = Thumb.new()
	for i in 100:
		a.refresh(look)
		b.refresh(look)
	t.eq(Thumb._waiters[path].size(), 2, "100 refreshes, two cards, shared source: two redraw callbacks")
	t.ok(a.queue_redraw in Thumb._waiters[path], "first card still receives completion")
	t.ok(b.queue_redraw in Thumb._waiters[path], "second card still receives completion")
	a.free()
	b.free()
	Thumb._waiters.erase(path)


func test_rebuilding_cards_prunes_freed_waiters() -> void:
	var path := "/wo987-pending-rebuild"
	Thumb._waiters[path] = []
	for i in 100:
		var card: Control = Thumb.new()
		Thumb._fetch(path, card.queue_redraw)
		t.eq(Thumb._waiters[path].size(), 1, "only current card waits after rebuild %d" % i)
		card.free()
	Thumb._waiters.erase(path)
