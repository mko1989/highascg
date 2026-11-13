extends RefCounted
## WO-1053 — Visuals route groups (several stack positions → one transparent composite and one ring `<ring>-<name>`) and the
## picked layers back in the tab's PRV / PGM views: the model (exclusivity, slugs, never `L<digits>`, empty groups dropped,
## a solo-only show unchanged, route_keys, new group names), the deck (a group's layers in one composite in stack order, a
## key change keeps the running slot), the mixer (one mix per key), the rings (per key, drained; stub publisher), Sources ▸
## Live (group rows first, payloads, the route menu, a drag inside a group changes nothing) and the previews (the key
## composites on top of each view, lowest position first, premultiplied).

const L := preload("res://features/visuals/visuals_layers.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const Deck := preload("res://features/visuals/visuals_deck.gd")
const Mixer := preload("res://features/visuals/visuals_mixer.gd")
const Solo := preload("res://features/visuals/visuals_solo.gd")
const Preview := preload("res://features/visuals/visuals_route_preview.gd")
const VS := preload("res://features/live/visuals_solo_rows.gd")
const LiveM := preload("res://features/live/live_sources_model.gd")
const FIVE := [{"scene": "tunnel"}, {"scene": "rings"}, {"scene": "particles"}, {"scene": "starfield"}, {"scene": "spectrum"}]
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
	s.publish_check = func() -> String: return ""
	return made


func _tab(output: Dictionary, layers: Array) -> Control:
	var tab: Control = preload("res://features/visuals/visuals_tab.gd").new()
	tab._ready()
	tab.slice = M.slice_of({"visuals": {"output": output, "layers": layers}})
	tab._go(false)
	tab.page.set_state(tab.slice, {})
	return tab


func test_model_groups_normalise() -> void:
	t.eq(M.groups_of({"overlay": [5, 4, "4"], "Bad": [1], "L3": [2], "l7": [3], "x".repeat(25): [6], "a": [4, 6],
		"empty": [], "b": [0, 99], "ok-2": "junk"}), {"a": [4, 6], "overlay": [5]},
		"slugs only (no caps, no L<digits>, ≤24); a position in one group (the first by name); empty / junk dropped")
	t.eq([M.group_name_ok("overlay"), M.group_name_ok("group-2"), M.group_name_ok("x".repeat(24)), M.group_name_ok("L4"),
		M.group_name_ok("l12"), M.group_name_ok(""), M.group_name_ok("a b"), M.group_name_ok(4), M.group_name_ok("l4x")],
		[true, true, true, false, false, false, false, false, true], "group names")
	var o: Dictionary = M.slice_of({"visuals": {"output": {"solo": [2, 4], "groups": {"overlay": [4, 5]}}}}).output
	t.eq([o.solo, o.groups], [[2], {"overlay": [4, 5]}], "the group wins over solo (4 leaves the solo list)")
	t.eq(M.slice_of({"visuals": {"output": {"groups": {"overlay": []}}}}).output.has("groups"), false, "an empty group: no key")
	var only: Dictionary = M.slice_of({"visuals": {"output": {"ring": true, "solo": [3, 1]}}}).output
	t.eq([only.has("groups"), only.solo], [false, [1, 3]], "a solo-only show: unchanged (WO-1051)")
	t.eq(M.slice_of({"visuals": {"output": {"solo": [1], "groups": {"overlay": [1]}}}}).output.has("solo"), false,
		"solo emptied by a group: no solo key")
	t.eq(M.route_keys(only), {1: "L1", 3: "L3"}, "solo-only route keys = own keys")
	t.eq(M.route_keys({"solo": [1, 4], "groups": {"overlay": [5, 4]}}), {1: "L1", 4: "overlay", 5: "overlay"}, "route keys")
	t.eq(M.route_keys(null), {}, "nothing picked")
	t.eq([M.key_ring("visuals", "overlay"), M.key_ring("probe", "L4"), M.solo_ring("visuals", 4)],
		["visuals-overlay", "probe-L4", "visuals-L4"], "rings <ring>-<key>")
	t.eq([M.new_group_name({}), M.new_group_name({"overlay": [1]}), M.new_group_name({"overlay": [1], "group-2": [2]}),
		M.new_group_name({"group-2": [2]})], ["overlay", "group-2", "group-3", "overlay"], "new group names")
	var h := _host({}, FIVE)
	var s: Node = Solo.new(h)
	t.eq(s.keep({"ring": true, "solo": [2], "groups": {"overlay": [4]}}, {"screen": 1}),
		{"screen": 1, "solo": [2], "groups": {"overlay": [4]}}, "a page Output edit keeps solo and groups")
	h.free()


func test_deck_group_composite_in_stack_order() -> void:
	var d: Node = Deck.new()
	d.apply(L.normalize(FIVE), {}, 0.0)
	d.set_solo({2: "overlay", 3: "L3", 5: "overlay"})
	t.eq(d.solo.keys(), ["overlay", "L3"], "one composite per key")
	var ov: SubViewport = d.solo["overlay"]
	t.eq([ov.get_child_count(), d.slots[1].rect.get_parent() == ov, d.slots[4].rect.get_parent() == ov],
		[2, true, true], "the group's two layers in one composite")
	t.eq([d.slots[1].rect.get_index(), d.slots[4].rect.get_index()], [0, 1], "in stack order (L2 under L5)")
	t.eq([d.out.get_child_count(), d.slots[2].rect.get_parent() == d.solo["L3"]], [3, true], "backdrop + L1 + L4 in out; L3 own")
	t.ok(d.draws_solo("overlay") and d.draws_solo(3), "draws_solo by key (a position = its own key)")
	var stage: Node3D = d.stage_at(4)
	var vp: SubViewport = d.slots[4].vp
	d.set_solo({2: "overlay", 3: "L3", 5: "L5"})
	t.ok(d.stage_at(4) == stage and d.slots[4].vp == vp and d.slots[4].rect.get_parent() == d.solo["L5"],
		"group → own: the same running slot, only the draw rect moved")
	t.eq([d.leaving.size(), d.slots[4].w, ov.get_child_count()], [0, 1.0, 1], "no fade; the group keeps L2")
	d.set_solo({2: "overlay", 3: "overlay", 5: "overlay"})
	t.eq([d.solo.keys(), ov.get_child_count(), d.slots[2].rect.get_index(), d.slots[4].rect.get_index()],
		[["overlay"], 3, 1, 2], "own → group: L3 between L2 and L5; L3 / L5 composites freed")
	t.ok(d.stage_at(4) == stage and d.slots[4].vp == vp, "still no restart")
	d.set_solo({7: "overlay"})
	t.eq([ov.get_child_count(), ov.render_target_update_mode, d.out.get_child_count()], [0, SubViewport.UPDATE_ONCE, 6],
		"a group past the stack: empty, transparent; everything back in out")
	d.set_solo({}, ["overlay"])
	t.ok(d.solo.has("overlay") and d.solo.size() == 1, "kept while draining")
	d.free()


func test_mixer_one_mix_per_key() -> void:
	var m: Node = Mixer.new()
	m.go(L.normalize(FIVE), {}, 0.0)
	m.set_solo({4: "overlay", 5: "overlay", 1: "L1"})
	t.eq(m.solo_out.keys().size(), 2, "two keys, two mixes")
	var mat: ShaderMaterial = m.get("_solo_mats")["overlay"]
	t.ok(mat.get_shader_parameter("a") == m.decks[0].solo["overlay"].get_texture()
		and mat.get_shader_parameter("b") == m.decks[1].solo["overlay"].get_texture(), "the group's mix: both decks' composite")
	t.ok(mat.shader.code.contains("blend_premul_alpha"), "premultiplied (MIX2)")
	m.set_x(0.5)
	t.eq([mat.get_shader_parameter("x"), m.get("_solo_mats")["L1"].get_shader_parameter("x")], [0.5, 0.5], "same crossfader")
	m.set_solo({1: "L1"}, ["overlay"])
	t.ok(m.solo_out.has("overlay") and m.deck().slots[3].rect.get_parent() == m.deck().out, "draining: kept, layers back in out")
	m.set_solo({})
	t.eq([m.solo_out.size(), m.decks[0].solo.size(), m.decks[1].solo.size()], [0, 0, 0], "all freed")
	m.free()


func test_rings_per_key() -> void:
	var h := _host({"ring": true, "groups": {"overlay": [2, 3]}}, FIVE.slice(0, 3))
	var s: Node = Solo.new(h)
	var made := _stub(s)
	s.sync()
	t.eq([made.size(), made[0].started[0][1], made[0].started[0][0] == h.mixer.solo_out["overlay"], made[0].started[0][2]],
		[1, "visuals-overlay", true, 25], "one ring for the group, its mix, the main ring's rate")
	s.set_route(1, "overlay")
	t.eq([made.size(), h.slice.output.groups, h.stored], [1, {"overlay": [1, 2, 3]}, 1], "joining a group: no new ring")
	t.ok(h.mixer.deck().slots[0].rect.get_parent() == h.mixer.deck().solo["overlay"], "…its layer in the group's composite")
	s.set_route(1, "L1")
	t.eq([made.size(), made[1].started[0][1], h.slice.output.solo, h.slice.output.groups], [2, "visuals-L1", [1],
		{"overlay": [2, 3]}], "own: its own ring, out of the group")
	s.set_route(1, "L9")
	s.set_route(1, "Bad Name")
	t.eq([h.stored, s.route_of(1)], [2, "L1"], "a foreign own key or a bad group name: ignored")
	s.set_route(2, "")
	s.set_route(3, "")
	t.eq([made[0].sink, h.mixer.solo_out.has("overlay"), h.slice.output.has("groups")], [null, false, false],
		"the group emptied: dropped, its ring drained (0 s here) and closed")
	s.set_route(7, "overlay")
	t.eq([made.size(), made[2].started[0][1], h.mixer.decks[0].solo["overlay"].get_child_count()], [3, "visuals-overlay", 0],
		"a group past the stack: its ring runs, transparent")
	h.slice.output.ring = false
	s.sync()
	t.eq([made[1].sink, made[2].sink, h.mixer.solo_out.size(), h.slice.output.groups], [null, null, 0, {"overlay": [7]}],
		"Live source off: every ring stops, the routes wait")
	h.free()


func test_group_ring_drains_in_tree() -> void:
	var h := _host({"ring": true, "groups": {"overlay": [1, 2]}}, FIVE.slice(0, 2))
	t.root.add_child(h)
	var s: Node = Solo.new(h)
	var made := _stub(s)
	s.drain_s = 0.1
	s.sync()
	s.set_route(1, "")
	s.set_route(2, "")
	t.ok(made[0].sink != null and h.mixer.solo_out.has("overlay"), "the group gone: its ring keeps publishing a moment")
	t.ok(h.mixer.deck().slots[1].rect.get_parent() == h.mixer.deck().out, "…while its layers are already in the canvas")
	s.set_route(2, "overlay")
	await t.create_timer(0.25).timeout
	t.eq([made.size(), made[0].sink], [1, "visuals-overlay"], "the group back within the drain: the same ring")
	s.set_route(2, "")
	await t.create_timer(0.25).timeout
	t.eq([s.pubs.size(), h.mixer.solo_out.size()], [0, 0], "after the drain: closed and freed")
	h.queue_free()


func _vals(rows: Array) -> Array:
	return rows.map(func(s: Dictionary) -> String: return str(s.value))


func test_sources_live_group_rows_and_route_menu() -> void:
	var tab := _tab({"ring": true}, FIVE)
	var made := _stub(tab.solo)
	var r4: Dictionary = VS.row(VS.children(tab)[1], tab)  # L4 (top first: L5, L4, …)
	var pop: PopupMenu = r4.menu.get_popup()
	t.eq(range(pop.item_count).map(func(i: int) -> String: return pop.get_item_text(i)),
		["Main (in visuals)", "Own (L4)", "New group… (overlay)"], "route menu: Main / Own / New group…")
	pop.id_pressed.emit(2)
	t.eq([tab.slice.output.get("groups"), made.size(), made[0].started[0][1]], [{"overlay": [4]}, 1, "visuals-overlay"],
		"New group… → `overlay`, its ring")
	var r5: Dictionary = VS.row(VS.children(tab)[1], tab)  # now: overlay, L5, …
	var pop5: PopupMenu = r5.menu.get_popup()
	t.eq(pop5.get_item_text(2), "Group overlay", "an existing group is offered")
	pop5.id_pressed.emit(2)
	t.eq([tab.slice.output.groups, made.size()], [{"overlay": [4, 5]}, 1], "L5 joins: the same ring")
	var server := [{"type": "shm", "value": "shm://visuals", "label": "visuals"},
		{"type": "shm", "value": "shm://visuals-overlay", "label": "visuals-overlay"},
		{"type": "shm", "value": "shm://visuals-overlayx", "label": "not ours"}]
	var rows := VS.insert(server, tab)
	t.eq(_vals(rows), ["shm://visuals", "shm://visuals-overlay", "shm://visuals-overlay", "shm://visuals-overlay",
		"shm://visuals-L3", "shm://visuals-L2", "shm://visuals-L1", "shm://visuals-overlayx"],
		"group row first, then layers top first (L5 / L4 carry the group ring); the server's group row hidden")
	t.eq([rows[1].text, rows[1].label, rows[2].text, rows[2].route, rows[4].route], ["overlay · L4 L5", "Visuals overlay",
		"L5 · Spectrum", "overlay", ""], "group row text / label; layer routes")
	var want := {"type": "shm", "value": "shm://visuals-overlay", "label": "Visuals overlay", "routeType": "shm"}
	t.eq([VS.payload(rows[1]), LiveM.drag_payload(rows[1]), VS.payload(rows[2])], [want, want, want], "payloads")
	var g: Dictionary = VS.row(rows[1], tab)
	t.eq([g.has("menu"), g.drag.call(Vector2.ZERO)], [false, want], "a group row: no menu, drags the group ring")
	var before: Dictionary = tab.slice.output.duplicate(true)
	var stored: int = made.size()
	t.eq(VS.row(rows[2], tab).drag.call(Vector2.ZERO), want, "a layer row in a group drags the group ring")
	t.eq([tab.slice.output, made.size()], [before, stored], "…and changes nothing")
	var r2: Dictionary = VS.row(rows[5], tab)
	t.eq(r2.drag.call(Vector2.ZERO), {"type": "shm", "value": "shm://visuals-L2", "label": "Visuals L2", "routeType": "shm"},
		"a main layer's drag: its own ring")
	t.eq([tab.slice.output.solo, made[-1].started[0][1]], [[2], "visuals-L2"], "…and it goes Own (WO-1051)")
	var r1: Dictionary = VS.row(VS.children(tab)[-1], tab)
	t.eq(r1.menu.get_popup().get_item_text(3), "New group… (group-2)", "the next new group is group-2")
	r1.menu.get_popup().id_pressed.emit(3)
	t.eq(tab.slice.output.groups, {"group-2": [1], "overlay": [4, 5]}, "group-2 made")
	t.eq(_vals(VS.insert(server, tab)).slice(1, 3), ["shm://visuals-group-2", "shm://visuals-overlay"], "groups by name")
	var ll: Node = tab.page.layer_list
	t.eq([ll.rows[3].solo.text, ll.rows[4].solo.visible, ll.rows[1].solo.text, ll.rows[0].solo.text, ll.rows[2].solo.visible],
		["overlay", true, "L2", "group-2", false], "layer list badges show the key")
	for x in [r4, r5, g, r2, r1]:
		x.panel.free()
	tab.free()


func test_previews_draw_key_composites_on_top() -> void:
	t.eq([Preview.order({1: "overlay", 3: "L3", 5: "overlay"}), Preview.order({2: "L2", 4: "overlay", 5: "overlay"})],
		[["overlay", "L3"], ["L2", "overlay"]], "keys by their lowest position")
	var tab := _tab({"ring": true, "solo": [2], "groups": {"overlay": [4, 5]}}, FIVE)
	_stub(tab.solo)
	tab.solo.sync()
	var canvas: TextureRect = tab.get("_canvas")
	var ov: Array = Preview.overlays(canvas)
	var m: Node = tab.mixer
	t.eq(ov.map(func(c: TextureRect) -> Texture2D: return c.texture), [m.solo_out["L2"].get_texture(),
		m.solo_out["overlay"].get_texture()], "PGM: the mix's key composites, L2 then overlay (on top)")
	t.eq([ov[0].get_index(), ov[1].get_index()], [0, 1], "under the view's tag")
	t.eq([(ov[0].material as CanvasItemMaterial).blend_mode, ov[0].stretch_mode, ov[0].mouse_filter],
		[CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA, canvas.stretch_mode, Control.MOUSE_FILTER_IGNORE],
		"premultiplied, letterboxed like the view, no input")
	tab.solo.sync()
	t.ok(Preview.overlays(canvas) == ov, "unchanged: not rebuilt")
	tab.dj.set_on(true)
	var prv: TextureRect = tab.dj.get("_prv")
	var d: Node = m.deck_of(1 - m.air())
	t.eq(Preview.overlays(prv).map(func(c: TextureRect) -> Texture2D: return c.texture), [d.solo["L2"].get_texture(),
		d.solo["overlay"].get_texture()], "PRV: the off-air deck's key composites")
	tab.solo.set_route(2, "")
	t.eq(Preview.overlays(canvas).map(func(c: TextureRect) -> Texture2D: return c.texture),
		[m.solo_out["overlay"].get_texture()], "a key gone: its overlay gone")
	tab.slice.output.ring = false
	tab.solo.sync()
	t.eq([Preview.overlays(canvas).size(), Preview.overlays(prv).size()], [0, 0], "not a Live source: no overlays")
	tab.free()
