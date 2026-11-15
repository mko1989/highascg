extends RefCounted
## WO-1085 — the spot handover settings twin (handover_model.gd normalize = src/fixtures/follow-handover.js
## normalizeHandover, same answers as node), the threshold lines clipped to the tracking grid, the status line, and
## follow_model keeping the slice (a Godot save that dropped it would switch the show back to Split).

const H := preload("res://features/previs/tracking/handover_model.gd")
const F := preload("res://features/previs/tracking/follow_model.gd")
var t


## Field by field (ints and floats compare as numbers, like node's JSON).
func _same(actual: Variant, expected: Variant, what: String) -> void:
	if expected is Dictionary:
		t.eq(actual is Dictionary and (actual as Dictionary).size() == expected.size(), true, what + " keys")
		for k in expected:
			_same(actual.get(k) if actual is Dictionary else null, expected[k], "%s.%s" % [what, k])
	else:
		t.eq(actual, expected, what)


func test_normalize_matches_node() -> void:
	# node -e "normalizeHandover(…)" on the box, 15.11.26
	_same(H.normalize(null), {"mode": "split", "heads": 3, "margin_m": 0.5, "fade_s": 1, "idle": "home",
		"levels": {"enabled": false, "protocol": "artnet", "universe": 100, "address": 1, "dest": ""},
		"grant": {"enabled": false, "universe": 0, "address": 512, "per_head": false}}, "defaults")
	_same(H.normalize({"mode": "handover", "heads": 40, "margin_m": -1, "fade_s": "x", "idle": "dark",
		"levels": {"enabled": true, "protocol": "sacn", "universe": 0, "address": 600, "dest": "  10.0.0.9:6454  "},
		"grant": {"enabled": true, "universe": 99999, "address": 0, "per_head": true}}),
		{"mode": "handover", "heads": 16, "margin_m": 0, "fade_s": 1, "idle": "dark",
		"levels": {"enabled": true, "protocol": "sacn", "universe": 1, "address": 512, "dest": "10.0.0.9:6454"},
		"grant": {"enabled": true, "universe": 32767, "address": 1, "per_head": true}}, "clamped")
	var r := H.normalize({"heads": 2.6, "levels": {"universe": 40000}})
	t.eq(r.heads, 3, "heads rounded")
	t.eq(r.levels.universe, H.PORT_ADDRESS_MAX, "Art-Net port-address clamped")


func test_follow_model_keeps_the_slice() -> void:
	var d := F.normalize({"handover": {"mode": "handover", "heads": 2}})
	t.eq(d.handover.mode, "handover", "a Godot save keeps the handover")
	t.eq(d.handover.heads, 2)
	t.eq(F.normalize({}).handover.mode, "split", "no key = Split (today's behaviour)")


func test_threshold_segments_clip_to_the_grid() -> void:
	# The live rig: heads along Y at x 4.9, the tracking grid 3 m wide around x 11.05, y −11 … 4.
	var grid := {"width": 3.0, "depth": 15.0, "x_offset": 11.05, "y_offset": -3.5, "z_offset": 0.639}
	var segs := H.segments([{"at": [4.9, -1.5], "dir": [0, -1]}, {"at": [4.9, 9.0], "dir": [0, 1]}], grid)
	t.eq(segs.size(), 2)
	var s: Array = segs[0]
	t.eq(absf(minf(s[0].x, s[1].x) - 9.55) < 1e-4, true, "clipped to the grid's stage-right edge")
	t.eq(absf(maxf(s[0].x, s[1].x) - 12.55) < 1e-4, true, "and its stage-left edge")
	t.eq(absf(s[0].y + 1.5) + absf(s[1].y + 1.5) < 1e-4, true, "across the rig at the threshold")  # Vector2 = float32
	var stub: Array = segs[1]  # beyond the grid's upstage edge: a short line at the point
	t.eq(stub[0].distance_to(stub[1]), 2 * H.STUB, "off-grid threshold drawn ± STUB")
	var diag := H.segments([{"at": [0, 0], "dir": [0.7071, 0.7071]}], {"width": 4.0, "depth": 4.0, "x_offset": 0.0, "y_offset": 0.0})
	t.eq(diag[0][0].distance_to(diag[0][1]) > 5.6, true, "a diagonal rig: corner to corner")
	t.eq(H.segments("junk", grid), [])
	t.eq(H.segments([{"at": [1]}], grid), [], "malformed entries dropped")


func test_status_text() -> void:
	t.eq(H.status_text({}).begins_with("Server not reporting"), true)
	t.eq(H.status_text({"mode": "split"}).begins_with("Split"), true)
	var st := {"mode": "handover", "thresholds": [{}, {}], "levels": {"enabled": true, "problem": "universe 1 is a rig universe"},
		"grant": {"enabled": true, "state": "live", "value": 255, "universe": 5}, "no_dimmer": ["g1"]}
	var s := H.status_text(st)
	t.eq(s.contains("2 thresholds"), true, s)
	t.eq(s.contains("rig universe"), true, "the levels problem is shown")
	t.eq(s.contains("HighAsCG drives the spot (255)"), true, s)
	t.eq(s.contains("no Dimmer channel: g1"), true, s)
	t.eq(H.grant_text({"state": "live", "value": 40}), "the console has the heads (40)")
	t.eq(H.grant_text({"state": "held"}).contains("held"), true)
	t.eq(H.grant_text({"state": "lost"}).contains("last frame"), true)
	t.eq(H.grant_text({"needs_through": true, "state": "live", "value": 255, "applied": 255}).contains("read-through"), true)


func test_grant_text_levels_mode() -> void:
	# WO-1085 follow-up: PSN + levels — the grant scales the levels; the status shows the fader and what is applied.
	t.eq(H.grant_text({"applies": "levels", "state": "live", "value": 128, "applied": 64}), "LD fader 50 % — levels × 25 %")
	t.eq(H.grant_text({"applies": "levels", "state": "held", "value": 255, "applied": 255}), "console silent — last grant held — levels × 100 %")
	t.eq(H.grant_text({"applies": "levels", "state": "lost", "applied": 51}), "console lost — levels fading to 0 — levels × 20 %")
	t.eq(H.grant_text({"applies": "levels", "state": "none", "universe": 5}), "no console frame on U5 yet — levels at 0")
	var s := H.status_text({"mode": "split", "levels": {"enabled": true, "live": true, "packets": 3},
		"grant": {"enabled": true, "applies": "levels", "state": "live", "value": 255, "applied": 255}})
	t.eq(s, "Split: every Auto head follows its person (WO-708) · levels: 3 packets · grant: LD fader 100 % — levels × 100 %")


func test_section_edits_and_hides() -> void:
	var sec: Node = load("res://features/previs/tracking/handover_section.gd").new()
	t.root.add_child(sec)
	await t.process_frame  # _ready builds the fields
	var got := []
	sec.edited.connect(func(h: Dictionary) -> void: got.append(h))
	sec.show_handover({})
	t.eq(sec._heads.visible, false, "Split: no spot settings")
	t.eq(sec._gr_on.visible and sec._lv_on.visible, true, "Split: the levels universe and the grant stay reachable")
	sec._mode.select(1)
	sec._mode.item_selected.emit(1)
	t.eq(got.size(), 1)
	t.eq(got[-1].mode, "handover")
	sec.show_handover(got[-1])
	t.eq(sec._heads.visible, true)
	t.eq(sec._lv_uni.visible, false, "levels rows hidden while off")
	sec._heads.value = 2
	t.eq(got[-1].heads, 2, "heads per person")
	sec._lv_on.button_pressed = true
	t.eq(got[-1].levels.enabled, true)
	sec.show_handover(got[-1])
	t.eq(sec._lv_uni.visible, true)
	sec.show_status({"mode": "handover", "thresholds": [{}]})
	t.eq(sec._status.text, "1 threshold")
	sec.queue_free()


func test_3d_lines_only_while_shown() -> void:
	var n: Node3D = load("res://features/previs/tracking/handover_3d.gd").new()
	t.root.add_child(n)
	var h := {"mode": "handover", "thresholds": [{"at": [0, 3], "dir": [0, 1]}, {"at": [0, 4], "dir": [0, 1]}]}
	n.show_thresholds(h, false)
	t.eq(n.get_child_count(), 0, "Follow section closed: nothing drawn")
	n.show_thresholds(h, true)
	t.eq(n.get_child_count(), 1, "one line mesh")
	var mesh: ImmediateMesh = (n.get_child(0) as MeshInstance3D).mesh
	t.eq((mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX] as PackedVector3Array).size(), 4, "two segments")
	n.show_thresholds({"mode": "split", "thresholds": h.thresholds}, true)
	t.eq(n.get_child(0).is_queued_for_deletion(), true, "Split: removed")
	n.queue_free()
