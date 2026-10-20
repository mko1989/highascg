extends RefCounted

## WO-606 — Shader Live view shaping (the node owns the working copy).

const M := preload("res://features/live/shader_live_model.gd")
var t


func test_instances_and_values() -> void:
	var a := {"key": "sh-a@1-103", "shaderId": "sh-a", "channel": 1, "pLayer": 103, "isPrv": false, "sceneName": "Look A"}
	var b := {"key": "sh-a@2-3", "shaderId": "sh-a", "channel": 2, "pLayer": 3, "isPrv": true, "sceneName": "Look A"}
	t.eq(M.instance_label(a), "sh-a — PGM ch1 L103 (Look A)")
	t.eq(M.instance_label(b), "sh-a — PRV ch2 L3 (Look A)")
	t.eq(M.follow_key([], "x"), "", "none live")
	t.eq(M.follow_key([a, b], "sh-a@2-3"), "sh-a@2-3", "keep")
	t.eq(M.follow_key([a, {"key": "sh-b@2-3"}], "sh-a@2-3"), "sh-b@2-3", "playlist hop: follow the layer")
	t.eq(M.follow_key([a, b], "gone@9-9"), "sh-a@1-103", "else the first (PGM)")
	t.eq(M.find_instance([a, b], "sh-a@2-3").channel, 2)
	t.eq(M.find_instance([a], "x"), {})
	t.eq(M.decimals(0.01), 2)
	t.eq(M.decimals(1.0), 0)
	t.eq(M.decimals(0.001), 3)
	t.eq(M.decimals(0.00001), 4, "capped")
	t.eq(M.fmt(0.5, 0.01), "0.50")
	t.eq(M.fmt(7.0, 1.0), "7")
	t.eq(M.to_color([1, 0.5, 0]).g, 0.5)
	t.eq(M.to_color([1, 0, 0, 0.25]).a, 0.25)
	t.eq(M.from_color(Color(0.123456, 0.5, 1, 0.3), 3), [0.1235, 0.5, 1.0], "vec3: no alpha, 4 dp")
	t.eq(M.from_color(Color(0, 0, 0, 0.3), 4).size(), 4)


func test_view_shaping() -> void:
	var view := {
		"sections": ["Motion", "Shape", "Look", "Colour", "Audio"],
		"controls": [{"id": "c", "section": "Colour"}, {"id": "m", "section": "Motion"}, {"id": "l", "section": "Look"}],
		"hiddenCount": 40,
		"params": [{"key": "image:A", "name": "A", "label": ""}, {"key": "image:B", "name": "B", "label": "Glow", "deep": true, "desc": "", "expr": "x * ◆", "passKey": "image", "context": "#1 x * ◆"}],
	}
	var sec := M.sections(view)
	t.eq(sec.map(func(s): return s.title), ["Motion", "Look", "Colour"], "server order, empty sections dropped")
	t.eq(M.summary(view), "3 key controls · 40 more in Advanced")
	t.eq(M.summary({"controls": []}).begins_with("No obvious controls"), true)
	var by := M.params_by_key(view)
	t.eq(M.param_name(by["image:A"]), "A")
	t.eq(M.param_name(by["image:B"]), "Glow", "operator label wins")
	t.eq(M.param_tip(by["image:B"]), "image — B\n#1 x * ◆")
	t.eq(M.param_line(by["image:B"]), "x * ◆", "no decode → raw calculation")
	t.eq(M.param_line(by["image:A"]), "", "named params have no line")
	t.eq(M.push_note({"push": null}), "", "curation ops push nothing")
	t.eq(M.push_note({"push": {"targets": 2, "errors": []}}), "")
	t.eq(M.push_note({"push": {"targets": 0, "errors": []}}).begins_with("Not on air"), true)
	t.eq(M.push_note({"push": {"targets": 1, "errors": ["1-3: boom"]}}), "CG UPDATE failed: 1-3: boom")
	t.eq(M.MIXER_ROWS.size(), 4)
