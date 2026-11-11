extends RefCounted
## WO-1039 — PixelHue Audio model: grouping, pairing, request bodies (shapes of Studio lib/studio-audio.js).

const M := preload("res://features/pixelhue/audio_model.gd")
var t


static func _ch(key: String, iface: int, ch: int, type: int, mute := 0, tone := 0) -> Dictionary:
	return {"key": key, "interfaceId": iface, "channel": ch, "type": type, "port": "P%d" % iface, "name": "Channel %d" % (ch + 1), "mute": mute, "tone": tone, "signal": null}


static func _state() -> Dictionary:
	return {"supported": true,
		"inputs": [_ch("i0", 1, 0, 1), _ch("i1", 1, 1, 1, 1), _ch("j0", 2, 0, 1)],
		"outputs": [_ch("o0", 5, 0, 2), _ch("o1", 5, 1, 2), _ch("p0", 6, 0, 2)],
		"routes": {"o0": "i0", "o1": null, "p0": null}}


func test_groups_and_summary() -> void:
	var s := _state()
	var g := M.group_by_port(s.inputs)
	t.eq(g.size(), 2, "two input ports")
	t.eq((g[0].channels as Array).size(), 2, "port 1 has two channels")
	t.eq(M.summary(s), "3 in · 3 out · 1 routed", "summary")


func test_pair_routes() -> void:
	var s := _state()
	var r := M.pair_routes(s, s.inputs[0], s.outputs[0], true)
	t.eq(r, [{"output": "o0", "input": "i0"}, {"output": "o1", "input": "i1"}], "pairs channel to channel")
	var off := M.pair_routes(s, s.inputs[0], s.outputs[0], false)
	t.eq(off, [{"output": "o0", "input": null}], "only existing crosspoints are removed")


func test_click_routes() -> void:
	var s := _state()
	t.eq(M.click_routes(s, s.inputs[0], s.outputs[0], false, false), [{"output": "o0", "input": null}], "active single click unroutes")
	t.eq(M.click_routes(s, s.inputs[2], s.outputs[2], true, true), [{"output": "p0", "input": "j0"}], "alt = single")
	t.eq(M.click_routes(s, s.inputs[1], s.outputs[2], true, false), [{"output": "p0", "input": "i0"}], "pair maps same-numbered channels (i1 click lands on channel 0 of p)")


func test_flag_bodies() -> void:
	var s := _state()
	t.eq(M.flag_body(s.inputs[0], "mute"), {"channels": [{"key": "i0", "type": 1, "mute": 1}]}, "mute on")
	t.eq(M.flag_body(s.inputs[1], "mute"), {"channels": [{"key": "i1", "type": 1, "mute": 0}]}, "mute off")
	var g: Dictionary = M.group_by_port(s.inputs)[0]
	t.eq(M.port_flag_state(g, "mute"), 1, "some muted")
	t.eq(M.port_flag_body(g, "mute").channels[0].mute, 1, "some -> all on")
	t.eq(M.clear_body(), {"clear": true}, "clear")
	t.eq(M.routes_body([]), {"routes": []}, "routes body")
