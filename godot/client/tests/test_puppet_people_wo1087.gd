extends RefCounted
## WO-1087 — test puppet people in the previs: world persons flagged `puppet` (src/tracking/puppet-people.js) become
## avatar cards with no camera at all, at their floor point on the stage floor (plane_z), in their own random look,
## labelled TEST; real (camera) world persons are not touched by this path; the Markers-section row's status line.

const M := preload("res://features/previs/tracking/person_cards_model.gd")
const Avatars := preload("res://features/previs/tracking/person_avatars.gd")
const PM := preload("res://features/previs/tracking/puppet_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
const Cards := preload("res://features/previs/tracking/person_cards.gd")
var t

const LOOK := {"top": [120, 32, 44], "bottom": [40, 90, 190], "skin": [247, 224, 206], "hair": [236, 224, 190], "hair_len": "long", "locked": true}


func _snap() -> Dictionary:
	return {"cameras": [], "world": {"fused": false, "plane_z": 0.639, "persons": [
		{"id": 900001, "x": 10.9, "y": 1.3, "height": 1.736, "keys": [], "age_s": 0, "puppet": true, "name": "TEST puppet 1", "traits": LOOK},
		{"id": 4, "x": 1.0, "y": 1.0, "height": 1.8, "keys": ["a:1"], "age_s": 0}]}}


func test_puppet_cards_need_no_camera() -> void:
	var cs := M.puppet_cards(_snap())
	t.eq(cs.size(), 1, "only the puppet: a real world person stays with cards()")
	var c: Dictionary = cs[0]
	t.eq([c.id, c.feet, c.height, c.joints], [900001, [10.9, 1.3, 0.639], 1.736, null], "id, feet on the stage floor (plane_z), height")
	t.eq(c.looks, [{"key": "puppet:900001", "traits": LOOK}], "its own look")
	t.eq([c.keys, c.tag], [["puppet:900001"], "TEST puppet 1"], "key + the TEST label")
	t.eq(M.cards(_snap(), []), [], "cards() (camera views) has nothing for it: no double")
	var odd := {"world": {"plane_z": 0.0, "persons": [{"id": 900002, "x": 0.0, "y": 0.0, "height": 9.0, "puppet": true},
		{"id": 900003, "x": 0.0, "y": 0.0, "height": null, "puppet": true}]}}
	var o := M.puppet_cards(odd)
	t.eq([o[0].height, o[1].height, o[0].looks, o[0].tag], [M.MAX_HEIGHT, M.DEFAULT_HEIGHT, [], "TEST puppet"], "clamped height, default height, no look")
	t.eq(M.puppet_cards(null), [], "no snapshot")
	t.eq(M.puppet_cards({"cameras": []}), [], "no world")


func test_avatar_layer_draws_and_labels_the_puppet() -> void:
	var layer := Avatars.new()
	layer.show_cards(M.puppet_cards(_snap()), 0.0)
	t.eq(layer.count(), 1, "one avatar")
	var a: Node3D = layer.avatar(900001)
	var sh: Dictionary = a.shown()
	t.ok((sh.colours.top as Color).is_equal_approx(Color8(120, 32, 44)), "wears the puppet's top")
	t.ok((sh.pos as Vector3).is_equal_approx(C.psn_to_godot([10.9, 1.3, 0.639])), "stands on the stage top")
	t.ok(absf(sh.height - 1.736) < 1e-4, "its height")
	t.ok(a.tag != null and a.tag.text == "TEST puppet 1" and a.tag.visible, "labelled TEST over the head")
	t.ok(a.hair_long.visible, "long hair")
	layer.show_cards([], 0.1)
	layer.show_cards([], 0.1 + Avatars.HOLD_S + 0.01)
	t.eq(layer.count(), 0, "stopped: gone after the hold")
	layer.free()


func test_puppet_shows_in_every_people_mode_but_off() -> void:
	for style in ["cards", "dummies", "avatars"]:  # no picture to cut out or paint: an avatar in cut-outs/dummies too
		var pc: Node3D = Cards.new()  # off-tree: no _ready (Config / Store / ui.cfg)
		pc.style = style
		pc._on = true
		pc.set_detections(_snap())
		t.eq(pc.avatars.count(), 1, "%s: the puppet as an avatar" % style)
		pc._clear()
		t.eq(pc.avatars.count(), 0, "%s: a style switch clears it" % style)
		pc.free()


func test_row_summary() -> void:
	t.ok(PM.people_summary(null).begins_with("No answer"), "no server")
	t.ok(PM.people_summary({"enabled": false}).begins_with("Off. "), "off")
	t.ok(PM.people_summary({"enabled": false, "stopped": "ttl"}).contains("time limit"), "time limit")
	t.eq(PM.people_summary({"enabled": true, "count": 2, "ends_in_s": 7100, "stage": {"degenerate": false}}),
		"ON — 2 test people walking the stage · off by itself in 119 min", "on")
	t.ok(PM.people_summary({"enabled": true, "count": 1, "ends_in_s": 60, "stage": {"degenerate": true}}).contains("stage centre"), "tiny stage")
	t.eq(PM.people_summary({"error": "count must be 1, 2 or 3"}), "Refused: count must be 1, 2 or 3", "refused")
