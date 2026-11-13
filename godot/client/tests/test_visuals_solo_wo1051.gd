extends RefCounted
## WO-1051 — Visuals layer positions as their own Live sources: the model (`output.solo` normalised, ring names, absent when
## unused), the deck (a solo position draws into its own transparent composite, not `out`; re-solo keeps the running slot;
## the base tint from the bottom non-solo layer; positions, not scenes), the mixer (`solo_out[n]` transparent, premultiplied,
## master / blackout / crossfader), the rings (published only while a Live source, started / drained / stopped with the solo
## list, a stub publisher) and Sources ▸ Live's child rows (labels, top first, drag payload, drag start solos, toggle off,
## the server's `<ring>-L<n>` rows hidden at the top level). WO-1053: composites are keyed by route key (`L<n>`), and the
## row's solo toggle is a route menu (Main / Own / groups / New group…).

const L := preload("res://features/visuals/visuals_layers.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const Deck := preload("res://features/visuals/visuals_deck.gd")
const Mixer := preload("res://features/visuals/visuals_mixer.gd")
const Solo := preload("res://features/visuals/visuals_solo.gd")
const VS := preload("res://features/live/visuals_solo_rows.gd")
const LiveM := preload("res://features/live/live_sources_model.gd")
const FOUR := [{"scene": "tunnel"}, {"scene": "rings"}, {"scene": "particles"}, {"scene": "starfield"}]
var t


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


## The Visuals tab's surface visuals_solo.gd reads (slice, mixer, ring_name, _store, _fps, can_publish).
class _Host:
	extends Node
	var slice := {}
	var mixer: Node
	var ring_name := "visuals"
	var stored := 0

	func _store() -> void:
		stored += 1

	func _fps() -> int:
		return 25

	func can_publish() -> String:
		return ""


func _host(output: Dictionary, layers: Array) -> Node:
	var h := _Host.new()
	h.slice = M.slice_of({"visuals": {"output": output, "layers": layers}})
	h.mixer = Mixer.new()
	h.add_child(h.mixer)
	h.mixer.go(h.slice.layers, {}, 0.0)
	return h


func _stub(s: Node) -> Array:
	var made := []
	s.make_publisher = func() -> Node:
		var p := _Pub.new()
		made.append(p)
		return p
	s.drain_s = 0.0
	return made


func test_model_solo_list_and_ring_names() -> void:
	t.eq(M.solo_of([4, "2", 4, 0, 9, 2.5, "x", 1.0, -3]), [1, 2, 4], "unique, sorted, 1..MAX, whole numbers only")
	t.eq(M.solo_of(null), [], "absent → none")
	t.eq(M.slice_of({"visuals": {"output": {"solo": [3, 1]}}}).output.solo, [1, 3], "stored with the output")
	t.eq(M.slice_of({}).output.has("solo"), false, "an older show: no solo key (byte-identical output)")
	t.eq(M.slice_of({"visuals": {"output": {"solo": []}}}).output.has("solo"), false, "an empty list is not stored")
	t.eq([M.solo_ring("visuals", 4), M.solo_ring("probe", 2)], ["visuals-L4", "probe-L2"], "ring names (+ the dev ring)")
	var h := _host({"solo": [2]}, FOUR)
	var s: Node = Solo.new(h)
	t.eq(s.keep({"ring": true, "solo": [2]}, {"screen": 1, "ring": true}), {"screen": 1, "ring": true, "solo": [2]},
		"a page Output edit keeps the solo list")
	t.eq(s.keep({"ring": true}, {"screen": 1}), {"screen": 1}, "none to keep")
	h.free()


func test_deck_routes_solo_positions() -> void:
	var d: Node = Deck.new()
	d.apply(L.normalize(FOUR), {}, 0.0)
	d.set_solo([2, 4])
	t.ok(d.slots[1].rect.get_parent() == d.solo["L2"] and d.slots[3].rect.get_parent() == d.solo["L4"], "solo layers in their composites")
	t.eq([d.solo["L2"].transparent_bg, d.out.get_child_count(), d.solo["L2"].get_child_count()], [true, 3, 1],
		"transparent; backdrop + 2 in out, 1 in the solo composite (no backdrop)")
	t.eq([d.slots[0].rect.get_index(), d.slots[2].rect.get_index()], [1, 2], "the rest over the backdrop, in order")
	t.eq(d.solo["L2"].render_target_update_mode, SubViewport.UPDATE_ALWAYS, "renders while drawn into")
	var rings: Node3D = d.stage_at(1)
	var vp: SubViewport = d.slots[1].vp
	d.set_solo([4])
	t.ok(d.stage_at(1) == rings and d.slots[1].vp == vp, "solo off: the same running slot, no restart")
	t.ok(d.slots[1].rect.get_parent() == d.out and d.slots[1].rect.get_index() == 2, "back in out, between its neighbours")
	t.eq([d.solo.has("L2"), d.leaving.size(), d.slots[1].w], [false, 0, 1.0], "its composite freed; no fade")
	d.set_solo([2, 4])
	t.ok(d.stage_at(1) == rings and d.slots[1].rect.get_parent() == d.solo["L2"], "re-solo: still the same running scene")
	d.set_solo([1])
	t.eq([d.slots[0].stage.base, d.slots[1].stage.base], [false, true], "the base is the bottom non-solo layer")
	d.slots[1].stage.bg_tint = Color(0.2, 0.4, 0.6)
	d.step(0.0)
	t.eq(d.get("_back").color, Color(0.2, 0.4, 0.6, 1.0), "the backdrop follows that layer, not the solo one")
	var tunnel: Dictionary = d.slots[0]
	d.apply(L.normalize([{"scene": "spectrum"}, {"scene": "rings"}]), {}, 1.0)
	t.ok(d.slots[0].rect.get_parent() == d.solo["L1"], "positions, not scenes: the new layer 1 plays in solo 1")
	t.ok(d.leaving.has(tunnel) and tunnel.rect.get_parent() == d.solo["L1"], "the replaced one fades out where it was (solo 1)")
	d.set_solo([1, 8])
	t.eq([d.solo["L8"].get_child_count(), d.solo["L8"].render_target_update_mode], [0, SubViewport.UPDATE_ONCE],
		"a position past the stack: an empty, transparent composite")
	d.set_solo([], [8])
	t.ok(d.solo.has("L8") and not d.solo.has("L1") and d.slots[0].rect.get_parent() == d.out, "kept (draining) but routes nothing")
	d.free()


func test_mixer_solo_out() -> void:
	var m: Node = Mixer.new()
	m.go(L.normalize([{"scene": "tunnel"}, {"scene": "rings"}]), {}, 0.0)
	m.set_solo([2])
	t.ok(m.solo_out["L2"].transparent_bg, "solo_out: transparent")
	var mat: ShaderMaterial = m.get("_solo_mats")["L2"]
	t.ok(mat.shader.code.contains("blend_premul_alpha") and mat.shader.code.contains("* master"), "premultiplied, times the master")
	t.ok(mat.get_shader_parameter("a") == m.decks[0].solo["L2"].get_texture()
		and mat.get_shader_parameter("b") == m.decks[1].solo["L2"].get_texture(), "mixes both decks' solo 2")
	t.eq(m.solo_out["L2"].render_target_update_mode, SubViewport.UPDATE_ALWAYS, "renders with the canvas")
	t.ok(m.deck().slots[1].rect.get_parent() == m.deck().solo["L2"], "the live deck routes it")
	m.resize(Vector2i(640, 360))
	t.eq([m.solo_out["L2"].size, m.decks[0].solo["L2"].size, m.solo_out["L2"].get_child(0).size],
		[Vector2i(640, 360), Vector2i(640, 360), Vector2(640, 360)], "resize follows out_vp")
	m.level = 0.5
	m.step(10.0)
	t.eq(mat.get_shader_parameter("master"), 0.5, "the master fader")
	m.blackout = true
	m.step(10.0)
	t.eq([m.get("_mat").get_shader_parameter("master"), mat.get_shader_parameter("master")], [0.0, 0.0],
		"blackout on both (the solo mix: transparent)")
	m.set_x(0.25)
	t.eq(mat.get_shader_parameter("x"), 0.25, "the crossfader")
	m.set_solo([3])
	t.eq(m.get("_solo_mats")["L3"].get_shader_parameter("x"), 0.25, "a new solo mix starts at the current crossfader")
	t.eq([m.solo_out.has("L2"), m.decks[0].solo.has("L2")], [false, false], "a dropped position is freed")
	m.set_solo([], [3])
	t.ok(m.solo_out.has("L3") and m.deck().slots[1].rect.get_parent() == m.deck().out, "kept while draining, layer back in out")
	m.set_solo([])
	t.eq([m.solo_out.size(), m.decks[0].solo.size()], [0, 0], "none left")
	m.free()


func test_rings_follow_live_source_and_solo_list() -> void:
	var h := _host({"ring": false, "solo": [2]}, [{"scene": "tunnel"}, {"scene": "rings"}, {"scene": "particles"}])
	var s: Node = Solo.new(h)
	var made := _stub(s)
	s.sync()
	var d: Node = h.mixer.deck()
	t.eq([made.size(), h.mixer.solo_out.size()], [0, 0], "not a Live source: the list waits, no ring")
	t.ok(d.slots[1].rect.get_parent() == d.out, "every layer in the canvas")
	h.slice.output.ring = true
	s.sync()
	t.eq(made.size(), 1, "Live source on: one ring")
	t.eq([made[0].started[0][0] == h.mixer.solo_out["L2"], made[0].started[0][1], made[0].started[0][2]], [true, "visuals-L2", 25],
		"solo_out[\"L2\"] as visuals-L2 at the main ring's rate")
	t.ok(d.slots[1].rect.get_parent() == d.solo["L2"], "layer 2 left the canvas")
	s.sync()
	t.eq(made.size(), 1, "a second sync starts nothing new")
	s.set_solo(5, true)
	t.eq([made.size(), made[1].started[0][1], h.slice.output.solo, h.stored], [2, "visuals-L5", [2, 5], 1],
		"a position past the stack: its ring runs (transparent), stored")
	t.eq(h.mixer.decks[0].solo["L5"].get_child_count(), 0, "nothing draws into it")
	s.set_solo(2, false)
	t.eq([made[0].sink, h.mixer.solo_out.has("L2"), h.slice.output.solo], [null, false, [5]], "solo off: drained (0 s here), closed")
	t.ok(d.slots[1].rect.get_parent() == d.out, "back in the canvas")
	h.slice.output.ring = false
	s.sync()
	t.eq([made[1].sink, h.mixer.solo_out.size(), h.slice.output.solo], [null, 0, [5]], "Live source off: rings stop, the list kept")
	h.slice.output.ring = true
	s.set_solo(5, false)
	t.eq(h.slice.output.has("solo"), false, "the last one off: no solo key")
	s.publish_check = func() -> String: return "libhshm_sink is not loaded"
	s.set_solo(1, true)
	t.eq([made.size(), s.note], [2, "libhshm_sink is not loaded"], "cannot publish: no ring, says why")
	h.free()


func test_drain_keeps_ring_until_it_is_transparent() -> void:
	var h := _host({"ring": true, "solo": [1]}, [{"scene": "tunnel"}, {"scene": "rings"}])
	t.root.add_child(h)
	var s: Node = Solo.new(h)
	var made := _stub(s)
	s.drain_s = 0.1
	s.sync()
	s.set_solo(1, false)
	t.ok(made[0].sink != null and h.mixer.solo_out.has("L1"), "solo off: the ring keeps publishing (Caspar holds the last frame)")
	t.ok(h.mixer.deck().slots[0].rect.get_parent() == h.mixer.deck().out, "…while the layer is already back in the canvas")
	s.set_solo(1, true)
	await t.create_timer(0.25).timeout
	t.eq([made.size(), made[0].sink], [1, "visuals-L1"], "solo again within the drain: the same ring, never closed")
	s.set_solo(1, false)
	await t.create_timer(0.25).timeout
	t.eq([s.pubs.size(), is_instance_valid(made[0]) and made[0].sink != null, h.mixer.solo_out.size()], [0, false, 0],
		"after the drain: closed and freed")
	h.queue_free()


func _tab() -> Control:
	var tab: Control = preload("res://features/visuals/visuals_tab.gd").new()
	tab._ready()
	return tab


func test_sources_live_child_rows() -> void:
	var tab := _tab()
	tab.slice = M.slice_of({"visuals": {"output": {"ring": true}, "layers": [{"scene": "tunnel"},
		{"scene": "rings", "visible": false}, {"scene": "shader", "shader": "x", "label": "Plasma"}]}})
	tab._go(false)
	tab.page.set_state(tab.slice, {})
	var made := _stub(tab.solo)
	tab.solo.publish_check = func() -> String: return ""
	var server := [{"type": "shm", "value": "shm://visuals", "label": "visuals"},
		{"type": "shm", "value": "shm://visuals-L2", "label": "visuals-L2"}, {"type": "decklink", "value": "1"},
		{"type": "shm", "value": "shm://visuals-L2x", "label": "not ours"}]
	var rows := VS.insert(server, tab)
	t.eq(rows.map(func(s: Dictionary) -> String: return str(s.value)), ["shm://visuals", "shm://visuals-L3", "shm://visuals-L2",
		"shm://visuals-L1", "1", "shm://visuals-L2x"], "children under visuals, top first; the server's visuals-L2 row hidden")
	t.eq([rows[1].text, rows[2].text, rows[3].text], ["L3 · Shader · Plasma", "L2 · Rings", "L1 · Tunnel"], "labels")
	t.eq([rows[1].muted, rows[2].muted], [false, true], "a hidden layer is muted")
	var want := {"type": "shm", "value": "shm://visuals-L2", "label": "Visuals L2", "routeType": "shm"}
	t.eq([VS.payload(rows[2]), LiveM.drag_payload(rows[2])], [want, want], "a ring row's drag shape")
	var r: Dictionary = VS.row(rows[2], tab)
	t.eq([r.menu.text, r.menu.get_popup().is_item_checked(0)], ["main", true], "not solo yet: Main (WO-1053 route menu)")
	t.eq(r.drag.call(Vector2.ZERO), want, "the drag carries the ring")
	t.eq(tab.slice.output.solo, [2], "starting the drag made position 2 solo")
	t.eq([made.size(), made[0].started[0][1]], [1, "visuals-L2"], "its ring started while the drag is in flight")
	t.ok(tab.scene.slots[1].rect.get_parent() == tab.scene.solo["L2"], "layer 2 left the canvas")
	t.ok(tab.page.layer_list.rows[1].solo.visible and not tab.page.layer_list.rows[0].solo.visible, "the L2 badge")
	var r2: Dictionary = VS.row(VS.children(tab)[1], tab)
	t.eq([r2.menu.text, r2.menu.get_popup().is_item_checked(1)], ["own", true], "the menu shows Own")
	r2.menu.get_popup().id_pressed.emit(0)  # WO-1053: Main (was the solo toggle off)
	t.eq([tab.slice.output.has("solo"), made[0].sink], [false, null], "Main: solo ended, the ring closed")
	t.ok(tab.scene.slots[1].rect.get_parent() == tab.scene.out, "back in the canvas")
	t.ok(not tab.page.layer_list.rows[1].solo.visible, "badge gone")
	tab.page.output_changed.emit({"screen": 0, "layer": 1, "size": 0, "ring": true})
	tab.solo.set_solo(3, true)
	tab.page.output_changed.emit({"screen": 0, "layer": 5, "size": 0, "ring": true})
	t.eq(tab.slice.output.get("solo"), [3], "an Output edit keeps the list")
	tab.slice.output.ring = false
	t.eq(VS.children(tab), [], "not a Live source: no children")
	t.eq(VS.insert(server, tab).size(), 3, "…and the server's visuals-L rows stay hidden")
	t.eq(VS.insert(server, null), server, "no Visuals tab on this client: rows unchanged")
	tab.slice.output.ring = true
	tab.dj.set_on(true)  # A/B: the canvas bank is slice.dj.other; the edited copy changes
	tab.slice.layers = L.normalize([{"scene": "particles"}])
	t.eq(VS.children(tab).map(func(s: Dictionary) -> String: return str(s.text)), ["L3 · Shader · Plasma", "L2 · Rings",
		"L1 · Tunnel"], "A/B: the bank on the canvas")
	r.panel.free()
	r2.panel.free()
	tab.free()
