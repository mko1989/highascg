extends RefCounted
## WO-1049 — Visuals layers routed to two outputs: the model (`out` absent = 1, output2 defaults, the ring name, the target
## through the channel map), the deck (out-2 layers in `out2` in stack order, re-routing keeps the running slot, the base tint
## stays an output-1 thing), the mixer (`out_vp2`: transparent, master / blackout, out2_changed), the route (start / move /
## stop plan, PLAY / STOP bodies through a fake API, Send off, replay, a cleared show) and the Live expander's rows editing
## a layer's route through the Visuals tab.

const L := preload("res://features/visuals/visuals_layers.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const Deck := preload("res://features/visuals/visuals_deck.gd")
const Mixer := preload("res://features/visuals/visuals_mixer.gd")
const Route := preload("res://features/visuals/visuals_route.gd")
const Looks := preload("res://features/visuals/visuals_looks.gd")
const RoutingPanel := preload("res://features/live/visuals_routing_panel.gd")
const CM := {"programChannels": [1, 3], "screenLabels": ["PGM/PRV 1", "PGM 2"],
	"programResolutions": [{"w": 3072, "h": 1024, "fps": 50}, {"w": 3072, "h": 1024, "fps": 25}]}
var t


class _Api:
	var posts: Array = []
	var fail := false

	func post_json(path: String, body: Dictionary) -> Dictionary:
		posts.append([path, body])
		return {"ok": not fail, "error": "nope"}


class _Pub:
	extends Node
	var sink: Variant = null
	var started: Array = []

	func start(vp: SubViewport, ring: String, fps := 50) -> String:
		started.append([vp, ring, fps])
		sink = ring
		return ""

	func stop() -> void:
		sink = null


func _tab() -> Control:
	var tab: Control = preload("res://features/visuals/visuals_tab.gd").new()
	tab._ready()
	return tab


func test_model_defaults_and_back_compat() -> void:
	var n := L.normalize([{"scene": "tunnel"}, {"scene": "rings", "out": 2}, {"scene": "particles", "out": "2"},
		{"scene": "starfield", "out": 7}])
	t.eq(n[0], {"scene": "tunnel", "opacity": 1.0, "visible": true, "blend": "normal"}, "no `out` stored for output 1")
	t.eq([L.out_of(n[0]), L.out_of(n[1]), L.out_of(n[2]), L.out_of(n[3])], [1, 2, 2, 1], "absent / junk = 1, 2 kept")
	t.eq(n[1].out, 2, "output 2 stored")
	t.eq(L.key(n[1]), L.key(L.normalize([{"scene": "rings"}])[0]), "the key ignores the route (no restart)")
	var r := L.routed(n, 0, 2)
	t.eq([L.out_of(r[0]), L.out_of(n[0])], [2, 1], "routed: a copy, the list passed in untouched")
	t.eq(L.routed(r, 0, 1)[0].has("out"), false, "back to 1 erases the field")
	t.ok(L.uses_out2(n) and not L.uses_out2(L.normalize([{"scene": "rings"}])), "uses_out2")
	t.eq(L.from_payload({"scene": "tunnel"}, n[1]).out, 2, "a replaced picture keeps its route")
	t.eq(L.from_payload({"scene": "tunnel"}).has("out"), false, "a new layer → output 1")
	var old := M.slice_of({"visuals": {"output": {"screen": 0, "layer": 20}}})
	t.eq(old.output2, {"screen": 1, "layer": 20}, "no output2 stored: screen 1 (second main), output 1's layer")
	t.eq(M.slice_of({"visuals": {"output2": {"screen": 3, "layer": 0}}}).output2, {"screen": 3, "layer": 1}, "clamped")
	t.eq([M.ring2(), M.ring2("probe")], ["visuals-2", "probe-2"], "ring name (+ the dev ring)")
	var looks := Looks.normalize([Looks.capture(M.slice_of({"visuals": {"layers": [{"scene": "rings", "out": 2}]}}))])
	t.eq(L.out_of(looks[0].layers[0]), 2, "a look keeps the route")


func test_target_through_the_channel_map() -> void:
	var s := M.slice_of({"visuals": {"output": {"screen": 0, "layer": 20}}})
	t.eq(M.output2_target(CM, s), {"channel": 3, "layer": 20}, "default: the second main's PGM channel, same layer")
	t.eq(M.output2_target({"programChannels": [1]}, s), {"channel": 1, "layer": 21},
		"one main: screen 0, one layer above output 1 (never replacing its PLAY)")
	s.output2 = {"screen": 0, "layer": 5}
	t.eq(M.output2_target(CM, s), {"channel": 1, "layer": 5}, "the same channel on another layer")
	t.eq(M.output2_target({}, s).channel, 0, "no screens: no channel")
	t.eq(M.output2_target({"programChannels": [1, null], "channelsWhereCabled": true}, M.slice_of({})).channel, 1,
		"WO-1029: a screen cabled elsewhere is not offered → the first local one")


func test_deck_composites_out2_in_stack_order() -> void:
	var d: Node = Deck.new()
	d.apply(L.normalize([{"scene": "tunnel"}, {"scene": "rings", "out": 2}, {"scene": "particles"},
		{"scene": "starfield", "out": 2}]), {}, 0.0)
	t.eq([d.out2.transparent_bg, d.out.get_child_count(), d.out2.get_child_count()], [true, 3, 2],
		"out2 transparent; backdrop + 2 in out, 2 in out2 (no backdrop)")
	t.ok(d.slots[1].rect.get_parent() == d.out2 and d.slots[3].rect.get_parent() == d.out2, "out-2 layers in out2")
	t.eq([d.slots[1].rect.get_index(), d.slots[3].rect.get_index()], [0, 1], "in stack order")
	t.eq([d.slots[0].rect.get_index(), d.slots[2].rect.get_index()], [1, 2], "out-1 layers over the backdrop")
	t.eq([d.uses_out2(), d.out2.render_target_update_mode], [true, SubViewport.UPDATE_ALWAYS], "out2 renders while used")
	var rings: Node3D = d.stage_at(1)
	var vp: SubViewport = d.slots[1].vp
	d.apply(L.normalize([{"scene": "tunnel"}, {"scene": "rings"}, {"scene": "particles"}, {"scene": "starfield", "out": 2}]), {}, 1.0)
	t.ok(d.stage_at(1) == rings and d.slots[1].vp == vp, "re-routed to 1: the same running slot, no restart")
	t.eq([d.slots[1].w, d.leaving.size()], [1.0, 0], "no fade in or out")
	t.ok(d.slots[1].rect.get_parent() == d.out and d.slots[1].rect.get_index() == 2, "drawn in out, between its neighbours")
	d.apply(L.normalize([{"scene": "tunnel", "out": 2}, {"scene": "rings"}]), {}, 0.0)
	t.eq([d.slots[0].stage.base, d.slots[1].stage.base], [false, true], "the base (tint) is output 1's bottom layer")
	d.slots[1].stage.bg_tint = Color(0.2, 0.4, 0.6)
	d.step(0.0)
	t.eq(d.get("_back").color, Color(0.2, 0.4, 0.6, 1.0), "the backdrop follows output 1's base, not the out-2 layer")
	d.apply(L.normalize([{"scene": "tunnel"}]), {}, 0.0)
	t.eq([d.uses_out2(), d.out2.render_target_update_mode], [false, SubViewport.UPDATE_ONCE],
		"nothing in out2: one last (transparent) frame, then asleep")
	d.free()


func test_mixer_out_vp2() -> void:
	var m: Node = Mixer.new()
	var said := []
	m.out2_changed.connect(func(on: bool) -> void: said.append(on))
	t.ok(m.out_vp2 != null and m.out_vp2.transparent_bg, "out_vp2: transparent")
	t.ok(m._mat2.shader.code.contains("blend_premul_alpha") and m._mat2.shader.code.contains("* master"),
		"premultiplied through, times the master")
	m.go(L.normalize([{"scene": "tunnel"}, {"scene": "rings", "out": 2}]), {}, 0.0)
	t.eq([said, m.uses_out2(), m.out_vp2.render_target_update_mode], [[true], true, SubViewport.UPDATE_ALWAYS], "on: told, rendering")
	t.ok(m._mat2.get_shader_parameter("a") == m.decks[0].out2.get_texture(), "mixes the decks' out2")
	m.resize(Vector2i(640, 360))
	t.eq([m.out_vp2.size, m.decks[0].out2.size], [Vector2i(640, 360), Vector2i(640, 360)], "same size as the canvas")
	m.level = 0.5
	m.step(10.0)
	t.eq(m._mat2.get_shader_parameter("master"), 0.5, "the master fader on output 2")
	m.blackout = true
	m.step(10.0)
	t.eq([m._mat.get_shader_parameter("master"), m._mat2.get_shader_parameter("master")], [0.0, 0.0],
		"blackout on both (output 2: transparent)")
	m.set_x(0.25)
	t.eq(m._mat2.get_shader_parameter("x"), 0.25, "the crossfader on output 2")
	m.go(L.normalize([{"scene": "tunnel"}, {"scene": "rings"}]), {}, 0.0)
	t.eq([said, m.out_vp2.render_target_update_mode], [[true, false], SubViewport.UPDATE_ONCE], "off: told, asleep")
	m.free()


func test_route_plan() -> void:
	var tg := {"channel": 3, "layer": 20}
	t.eq(Route.plan(true, {}, tg, false), "start", "wanted, not on air")
	t.eq(Route.plan(true, {"channel": 3, "layer": 20}, tg, true), "", "on air where it belongs")
	t.eq(Route.plan(true, {"channel": 3, "layer": 21}, tg, true), "move", "the target changed")
	t.eq(Route.plan(false, {"channel": 3, "layer": 20}, tg, true), "stop", "no longer wanted")
	t.eq(Route.plan(false, {}, tg, true), "stop", "a ring left open")
	t.eq(Route.plan(false, {}, tg, false), "", "nothing to do")
	t.eq(Route.plan(true, {}, {"channel": 0, "layer": 1}, false), "", "no screen: nothing to play")


func test_route_with_a_stub_tab() -> void:
	var host := _Host.new()
	var api := _Api.new()
	host.replay_api = api
	host.slice = M.slice_of({"visuals": {"output": {"screen": 0, "layer": 20},
		"layers": [{"scene": "tunnel"}, {"scene": "rings"}]}})
	host.mixer = Mixer.new()
	host.add_child(host.mixer)
	host.mixer.go(host.slice.layers, {}, 0.0)
	var r: Node = Route.new(host)
	var pub := _Pub.new()
	r.publisher.free()
	r.publisher = pub
	r.add_child(pub)
	await r.sync()
	t.eq([api.posts, pub.sink], [[], null], "Send off, nothing routed: nothing")
	host.sending = {"channel": 1, "layer": 20}
	await r.sync()
	t.eq(api.posts, [], "sent, but no layer on output 2: no second PLAY")
	host.slice.layers = L.routed(host.slice.layers, 1, 2)
	host.mixer.go(host.slice.layers, {}, 0.0)  # out2_changed → sync()
	await r.sync()
	t.eq(api.posts, [["/api/play", {"channel": 3, "layer": 20, "clip": "shm://visuals-2", "loop": false}]],
		"a layer routed to 2: PLAY shm://visuals-2 on the second main's PGM channel")
	t.eq([pub.started.size(), pub.started[0][0] == host.mixer.out_vp2, pub.started[0][1], pub.started[0][2]],
		[1, true, "visuals-2", 25], "publishing out_vp2 at the second screen's rate")
	t.eq(r.sending, {"channel": 3, "layer": 20}, "on air")
	api.posts.clear()
	host.slice.output2 = {"screen": 1, "layer": 30}
	await r.sync()
	t.eq(api.posts, [["/api/stop", {"channel": 3, "layer": 20}],
		["/api/play", {"channel": 3, "layer": 30, "clip": "shm://visuals-2", "loop": false}]], "a new target: moved")
	t.eq(pub.started.size(), 1, "the ring stays open while moving")
	api.posts.clear()
	host.replay_api = api
	await r.replay()
	t.eq(api.posts, [["/api/play", {"channel": 3, "layer": 30, "clip": "shm://visuals-2", "loop": false}]], "replay after a Caspar restart")
	api.posts.clear()
	host.sending = {}
	await r.sync()
	t.eq([api.posts, pub.sink, r.sending], [[["/api/stop", {"channel": 3, "layer": 30}]], null, {}],
		"Send off: STOP of output 2's layer only, the ring closed")
	host.sending = {"channel": 1, "layer": 20}
	await r.sync()
	api.posts.clear()
	host.slice.layers = L.routed(host.slice.layers, 1, 1)
	host.mixer.go(host.slice.layers, {}, 0.0)
	await r.sync()
	t.eq([api.posts, pub.sink], [[["/api/stop", {"channel": 3, "layer": 30}]], null], "no layer on 2 any more: stopped")
	await r.sync()
	api.fail = true
	host.slice.layers = L.routed(host.slice.layers, 0, 2)
	host.mixer.go(host.slice.layers, {}, 0.0)
	await r.sync()
	t.eq([r.sending, pub.sink, r.note.begins_with("Output 2 PLAY failed")], [{}, null, true], "a failed PLAY says why")
	api.fail = false
	await r.sync()
	api.posts.clear()
	r.end()
	t.eq([r.sending, pub.sink, api.posts], [{}, null, []], "a cleared show: over without a STOP")
	host.free()


## Owner 13.11: the Visuals run as a Live source (shm://visuals on a look), not Send — output 2 is then the `visuals-2` ring,
## published while a layer is on PGM 2 (for a look on the overlay screen) and never PLAYed by the route.
func test_route_live_source_publishes_without_play() -> void:
	var host := _Host.new()
	var api := _Api.new()
	host.replay_api = api
	host.slice = M.slice_of({"visuals": {"output": {"screen": 0, "layer": 20, "ring": true},
		"layers": [{"scene": "tunnel"}, {"scene": "rings"}]}})
	host.mixer = Mixer.new()
	host.add_child(host.mixer)
	host.mixer.go(host.slice.layers, {}, 0.0)
	var r: Node = Route.new(host)
	var pub := _Pub.new()
	r.publisher.free()
	r.publisher = pub
	r.add_child(pub)
	r.drain_s = 0.0
	await r.sync()
	t.eq([api.posts, pub.sink], [[], null], "Live source, nothing on PGM 2: no ring")
	host.slice.layers = L.routed(host.slice.layers, 1, 2)
	host.mixer.go(host.slice.layers, {}, 0.0)
	await r.sync()
	t.eq([api.posts, pub.sink, r.sending], [[], "visuals-2", {}], "a layer on PGM 2: visuals-2 published, no PLAY")
	t.ok(pub.started[0][0] == host.mixer.out_vp2, "the ring is out_vp2")
	host.sending = {"channel": 1, "layer": 20}
	await r.sync()
	t.eq([api.posts.size(), r.sending, pub.started.size()], [1, {"channel": 3, "layer": 20}, 1], "Send on as well: PLAYed, same ring")
	api.posts.clear()
	host.sending = {}
	await r.sync()
	t.eq([api.posts, pub.sink], [[["/api/stop", {"channel": 3, "layer": 20}]], "visuals-2"], "Send off: STOP, the Live-source ring stays")
	host.slice.layers = L.routed(host.slice.layers, 1, 1)
	host.mixer.go(host.slice.layers, {}, 0.0)
	await r.sync()
	t.eq(pub.sink, null, "nothing on PGM 2 any more: the ring stops")
	host.free()


## The Visuals tab's surface the route reads (visuals_tab.gd: sending, slice, mixer, ring_name, replay_api, _cm, can_publish).
class _Host:
	extends Node
	var sending := {}
	var slice := {}
	var mixer: Node
	var ring_name := "visuals"
	var replay_api: Variant = null
	var dj := {"on": false}

	func _cm() -> Variant:
		return CM

	func can_publish() -> String:
		return ""

	func _g(_n: String) -> Node:
		return null


func test_live_expander_routes_through_the_tab() -> void:
	var tab := _tab()
	tab.slice = M.slice_of({"visuals": {"layers": [{"scene": "tunnel"}, {"scene": "rings"}, {"scene": "particles"}]}})
	tab._go(false)
	var rings: Node3D = tab.scene.stage_at(1)
	var p: Node = RoutingPanel.new()
	p.tab = tab
	p.expand(true)
	t.eq(p.rows.size(), 3, "a row per layer of the bank on air")
	t.ok(p.rows[1].b1.button_pressed and not p.rows[1].b2.button_pressed, "PGM 1 by default")
	t.eq(p._list.get_child(0), p.rows[2].name.get_parent(), "top layer first")
	p.rows[1].b2.pressed.emit()
	t.eq([L.out_of(tab.slice.layers[1]), L.out_of(tab.slice.layers[0])], [2, 1], "the tab's slice: layer 2 → PGM 2")
	t.eq(tab.page.layer_list.layers[1].get("out"), 2, "the Visuals page got it (its own edit path)")
	t.ok(tab.scene.stage_at(1) == rings, "the same running scene")
	t.ok(tab.scene.slots[1].rect.get_parent() == tab.scene.out2, "drawn into output 2")
	t.ok(tab.mixer.uses_out2(), "the mixer knows")
	t.ok(p.rows[1].b2.button_pressed, "the row shows it")
	t.ok(p.head.text.contains("1 layer on PGM 2"), "the header sums it up")
	t.ok(tab.page.layer_list.rows[1].route.visible and not tab.page.layer_list.rows[0].route.visible, "the `2` badge")
	p.rows[1].b1.pressed.emit()
	t.eq(L.out_of(tab.slice.layers[1]), 1, "back to PGM 1")
	t.ok(tab.scene.stage_at(1) == rings and tab.scene.slots[1].rect.get_parent() == tab.scene.out, "still the same scene, in out")
	tab.route.set_output(2, 0, 7)
	t.eq(tab.slice.output2, {"screen": 0, "layer": 7}, "output 2's target stored in the slice")
	tab.route.set_output(1, 0, 9)
	t.eq(tab.slice.output.layer, 9, "output 1's target through the page's Output path")
	t.ok(p.note.text.begins_with("Send and Live source are off"), "says why nothing plays yet")
	tab.slice.output.ring = true
	p._sig = ""
	p.refresh()
	t.ok(p.note.text.contains("shm://visuals-2"), "Live source: names the PGM 2 ring to put on a look")
	p.free()
	tab.free()


func test_live_expander_ab_bank_on_air() -> void:
	var tab := _tab()
	tab.slice = M.slice_of({"visuals": {"layers": [{"scene": "tunnel"}]}})
	tab._go(false)
	tab.dj.set_on(true)  # editing the PRV copy; the bank on the canvas is slice.dj.other
	t.ok(tab.mixer.air() != tab.mixer.live, "A/B: the canvas is the other bank")
	var air: Node = tab.mixer.deck_of(tab.mixer.air())
	var tunnel: Node3D = air.stage_at(0)
	tab.route.set_layer_out(0, 2)
	t.eq([L.out_of(tab.slice.dj.other.layers[0]), L.out_of(tab.slice.layers[0])], [2, 1], "the bank on air is routed, not PRV")
	t.ok(air.stage_at(0) == tunnel and air.slots[0].rect.get_parent() == air.out2, "on its deck, in place")
	tab.free()
