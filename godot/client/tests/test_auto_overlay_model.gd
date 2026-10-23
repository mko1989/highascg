extends RefCounted
## WO-710 — the Auto tracking overlay's pure logic.

const M := preload("res://features/previs/tracking/auto_overlay_model.gd")
var t


func _data() -> Dictionary:
	return {
		"pool": [1.0, 2.0, 3.0, 4.0],
		"persons": [
			{"key": "w:3", "slot": 2.0, "x": 1.0, "y": 2.0, "name": "Anna", "heads": [1.0, 2.0], "lost": false},
			{"key": "cam_1:7", "slot": 0.0, "x": 0.0, "y": 0.0, "heads": [3.0], "lost": true},
		],
		"slots": [{"slot": 1.0, "key": null, "heads": 0.0, "ptz": []}, {"slot": 2.0, "key": "w:3", "heads": 2.0, "ptz": [5.0]}],
		"home": {"active": false, "after_s": 10.0, "idle_s": 0.0, "forced": false},
		"ptz": [{"id": 5.0, "name": "Front", "enabled": true}, {"id": 6.0, "name": "Off", "enabled": false}, {"id": 7.0, "name": "", "enabled": true}],
	}


func test_rows_from_data() -> void:
	var r := M.rows(_data())
	t.eq(r.size(), 2, "one row per person")
	t.eq(r[0].label, "Anna", "presenter name wins")
	t.eq(r[0].slot, 2, "pinned slot")
	t.ok(r[0].pinned, "pinned flag")
	t.eq(r[0].count, 2, "slot head setting")
	t.eq(r[0].following, 2, "heads now following")
	t.eq(r[0].ptz, ["5"], "ptz ids normalised")
	t.ok(not r[1].pinned, "unpinned person")
	t.eq(r[1].count, 0, "unpinned = share")
	t.ok(r[1].lost, "lost flag")
	t.eq(M.rows(null).size(), 0, "no data → no rows")


func test_label_and_short_key() -> void:
	t.eq(M.label({"key": "w:12"}), "Person w12", "world key")
	t.eq(M.label({"key": "cam_1:7"}), "Person c1.7", "camera key")
	t.eq(M.label({"key": "w:1", "name": "  "}), "Person w1", "blank name ignored")


func test_has_content_and_ptz() -> void:
	t.ok(M.has_content(_data()), "persons")
	t.ok(M.has_content({"pool": [1]}), "pool only")
	t.ok(not M.has_content({"persons": [], "pool": []}), "nothing")
	t.ok(not M.has_content(null), "null")
	var c := M.ptz_cams(_data())
	t.eq(c.size(), 2, "disabled camera dropped")
	t.eq(c[1].name, "Cam 7", "unnamed camera gets a name")


func test_count_stepper() -> void:
	t.eq(M.count_text(0), "share", "0 = share")
	t.eq(M.count_text(3), "3", "explicit")
	t.eq(M.step_count(0, 1, 4), 1, "share → 1")
	t.eq(M.step_count(1, -1, 4), 0, "1 → share")
	t.eq(M.step_count(0, -1, 4), 0, "floor")
	t.eq(M.step_count(4, 1, 4), 4, "capped by the pool")
	t.eq(M.step_count(0, 1, 0), 0, "empty pool")


func test_pin_and_ptz_toggle() -> void:
	t.eq(M.pin_target(0, 3), 3, "pin")
	t.eq(M.pin_target(3, 3), 0, "same pin again unpins")
	t.eq(M.pin_target(3, 5), 5, "move pin")
	t.eq(M.toggle_ptz([5.0], 5.0), [], "off")
	t.eq(M.toggle_ptz([5.0], 6.0), [5.0, 6.0], "on")
	t.eq(M.toggle_ptz([5.0], 5), [], "int vs float id")


func test_home_text_and_after() -> void:
	t.eq(M.home_text({"active": true, "forced": false}), "home", "active")
	t.eq(M.home_text({"active": true, "forced": true}), "home · manual", "forced")
	t.eq(M.home_text({"active": false, "after_s": 10.0, "idle_s": 3.2}), "home in 7s", "countdown")
	t.eq(M.home_text({"active": false, "after_s": 10.0, "idle_s": 0.0}), "", "someone seen")
	t.eq(M.home_text(null), "", "no home")
	t.eq(M.step_after(10, 1), 15, "+5")
	t.eq(M.step_after(5, -1), 3, "clamped low")
	t.eq(M.step_after(598, 1), 600, "clamped high")


func test_signature_stable_across_updates() -> void:
	var a := _data()
	var b := _data()
	b.persons[0].heads = [1.0]
	b.persons[0].slot = 0.0
	b.home.idle_s = 4.0
	t.eq(M.signature(a), M.signature(b), "pins/heads/home changes do not rebuild rows")
	b.persons.append({"key": "w:9", "slot": 0})
	t.ok(M.signature(a) != M.signature(b), "a new person rebuilds")
