extends RefCounted
## WO-1106 (4.4) — PixelHue ▸ Programming against a fake HTTP client: a double Take / Take + Cut while the geometry
## queue drains sends one command (C30), a read that started before a Take cannot put the pre-Take layers back (C39),
## a failed gallery read is retried and thumbnails go two at a time (C42), the opacity slider sends on a value change
## without a drag, debounced, and waits for a running command (C45).

const ProgPanel := preload("res://features/pixelhue/programming_panel.gd")
const Gallery := preload("res://features/pixelhue/programming_gallery.gd")
const Effects := preload("res://features/pixelhue/programming_effects.gd")
const M := preload("res://features/pixelhue/programming_model.gd")
const G := preload("res://features/pixelhue/programming_geometry.gd")
const T := preload("res://tests/test_pixelhue_programming.gd")
const PP := preload("res://tests/test_pixelhue_programming_panel.gd")
const P := preload("res://tests/test_pixelhue_panels_wo1106.gd")
const BASE := "/api/pixelhue/studio/"
var t


func _commands(posts: Array) -> Array:
	return posts.filter(func(x: Array) -> bool: return str(x[0]) == BASE + "programming")


func _wait(s := 0.15) -> void:
	await t.create_timer(s).timeout


# ---- C30 ----

func test_double_take_while_geometry_drains_sends_once() -> void:
	var api := PP.FakeApi.new()
	var p: ProgPanel = ProgPanel.new()
	p.api = api
	t.root.add_child(p)
	await t.process_frame
	await p.refresh()
	api.hold = true
	var l := M.layer_by_id(p.state, 54657024)
	p.live_geometry(M.window_change(p.state, l, G.win(5, 5, 1920, 1080)))  # a layer drag just ended
	p.command(M.take_body(p.shown, 500, true), "Take sent.")
	p.command(M.take_body(p.shown, 500, true), "Take sent.")  # double click
	p.command(M.cut_body(p.shown, true), "Cut sent.")  # or Cut right after
	t.eq(_commands(api.posts).size(), 0, "nothing goes while the geometry write is in flight")
	api.hold = false
	api.released.emit()
	await _wait()
	var sent := _commands(api.posts)
	t.eq(sent.size(), 1, "one command only: with Swap on, a second Take would flip PGM back")
	t.eq(str(sent[0][1].action), "take", "the first press")
	t.ok(not p._draining and not p.busy, "flags cleared")
	await p.command(M.cut_body(p.shown, true), "Cut sent.")
	t.eq(_commands(api.posts).size(), 2, "the next press after it works")
	p.queue_free()


func test_failed_drain_clears_the_guard() -> void:
	var api := PP.FakeApi.new()
	var p: ProgPanel = ProgPanel.new()
	p.api = api
	t.root.add_child(p)
	await t.process_frame
	await p.refresh()
	api.fail_geometry = "Layer X must be an integer."
	var l := M.layer_by_id(p.state, 54657024)
	p.live_geometry(M.window_change(p.state, l, G.win(7, 0, 1920, 1080)))
	await _wait()
	await p.command(M.take_body(p.shown, 500, true), "Take sent.")
	t.ok(not p._draining, "an early return clears the guard")
	api.fail_geometry = ""
	p._queue.retry()
	await _wait()
	await p.command(M.take_body(p.shown, 500, true), "Take sent.")
	t.eq(_commands(api.posts).size(), 1, "Take goes after Retry")
	p.queue_free()


# ---- C39 ----

func test_older_read_does_not_undo_a_take() -> void:
	var api := P.Fake.new()
	api.answers[BASE + "programming"] = T.state()
	api.answers[BASE + "gallery"] = {"pictures": [], "support": {}}
	var after: Dictionary = T.state()
	after.layers[1].name = "After Take"
	api.post_answers[BASE + "programming"] = after
	var p: ProgPanel = ProgPanel.new()
	p.api = api
	t.root.add_child(p)
	await t.process_frame
	await p.refresh()
	t.eq(str(M.layer_by_id(p.state, 100).name), "Layer 1", "loaded")
	api.hold = true
	p.refresh()  # a Refresh / tab change read, slow on the wire
	await p.command(M.take_body(p.shown, 500, true), "Take sent.")
	t.eq(str(M.layer_by_id(p.state, 100).name), "After Take", "the Take's answer is adopted")
	api.hold = false
	api.released.emit()  # the older read lands
	t.eq(str(M.layer_by_id(p.state, 100).name), "After Take", "the pre-Take read is dropped")
	p.queue_free()


# ---- C42 ----

func test_gallery_failed_read_is_retried_and_thumbs_go_two_at_a_time() -> void:
	var api := P.Fake.new()
	var g: Gallery = Gallery.new()
	g.api_fn = func() -> Object: return api
	t.root.add_child(g)
	await g.load_once()
	t.eq((g.gallery.get("pictures", []) as Array).size(), 0, "a failed read shows an empty gallery")
	api.answers[BASE + "gallery"] = {"pictures": [{"id": 1.0, "name": "bk"}], "support": {}}
	await g.load_once()
	t.eq(api.gets.size(), 2, "the next load reads again instead of keeping the failure")
	t.eq((g.gallery.pictures as Array).size(), 1, "pictures there")
	await g.load_once()
	t.eq(api.gets.size(), 2, "a successful read is kept")
	api.hold_bytes = true
	for id in [1, 2, 3, 4, 5]:
		g.thumb(id, func(_tex: Texture2D) -> void: pass)
	t.eq(api.byte_gets.size(), 2, "two thumbnails in flight, the rest wait")
	api.hold_bytes = false
	api.released.emit()
	t.eq(api.byte_gets.size(), 5, "the others follow as slots free")
	t.eq(g._thumb_running, 0, "nothing left running")
	g.queue_free()


# ---- C45 (opacity) ----

class Host:
	extends RefCounted
	var busy := false
	var sent: Array = []

	func command(body: Dictionary, _success := "") -> void:
		sent.append(body)


func _slider(fx: Effects) -> HSlider:
	var body := GridContainer.new()
	fx.add_child(body)
	fx._row(body, {"kind": "slider", "label": "Opacity", "path": ["opacity"], "value": 100, "min": 0, "max": 100, "msg": "Opacity saved."}, false)
	for c in body.get_child(1).get_children():
		if c is HSlider:
			return c as HSlider
	return null


func test_opacity_slider_sends_without_a_drag_debounced() -> void:
	var host := Host.new()
	var fx: Effects = Effects.new()
	fx.host = host
	fx._layer = {"id": 5, "screenId": 1, "fx": {"opacity": 100}}
	t.root.add_child(fx)
	var s := _slider(fx)
	s.value = 90  # arrow keys / wheel / a programmatic change: no drag_started
	s.value = 80
	s.value = 40
	t.eq(host.sent.size(), 0, "debounced, nothing yet")
	await _wait(Effects.SLIDER_DEBOUNCE_S + 0.2)
	t.eq(host.sent.size(), 1, "one send for the burst")
	t.eq(int(host.sent[0].effect.opacity), 40, "the last value")
	host.busy = true
	s.value = 30
	await _wait(Effects.SLIDER_DEBOUNCE_S + 0.2)
	t.eq(host.sent.size(), 1, "waits while a command runs (it would be dropped)")
	host.busy = false
	await _wait(Effects.SLIDER_DEBOUNCE_S + 0.2)
	t.eq(host.sent.size(), 2, "then sends")
	t.eq(int(host.sent[1].effect.opacity), 30, "the newest value")
	s.drag_started.emit()
	s.value = 20
	await _wait(Effects.SLIDER_DEBOUNCE_S + 0.2)
	t.eq(host.sent.size(), 2, "nothing mid-drag (a send re-renders and frees the slider)")
	s.drag_ended.emit(true)
	t.eq(host.sent.size(), 3, "the drag sends once on release")
	fx.queue_free()
