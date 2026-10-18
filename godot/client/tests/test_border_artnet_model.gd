extends RefCounted
## WO-601 global border lighting input — golden values from the web's global-border-artnet-map.js under node.

const A := preload("res://features/live/border_artnet_model.gd")
const NetUtil := preload("res://core/net_util.gd")
const LOCAL := {"enabled": false, "type": "border", "fadeDuration": 30, "params": {"width": 4, "color": "#e63946", "opacity": 1, "radius": 2, "glowColor": "#102030", "speed": 400}}
const REMOTE := {"enabled": true, "type": "glow", "params": {"width": 9, "color": "#00ff80", "opacity": 0.5, "radius": 7, "glowColor": "#ffffff", "speed": 100, "intensity": 3, "count": 4}}
const EXPECTED := ["{\"enabled\":true,\"type\":\"glow\",\"fadeDuration\":30,\"params\":{\"width\":9,\"color\":\"#00ff80\",\"opacity\":0.5,\"radius\":7,\"glowColor\":\"#ffffff\",\"speed\":100,\"side\":\"inside\",\"intensity\":3,\"count\":4}}", "{\"enabled\":true,\"type\":\"border\",\"fadeDuration\":30,\"params\":{\"width\":9,\"color\":\"#003980\",\"opacity\":0.5,\"radius\":2,\"glowColor\":\"#ffffff\",\"speed\":100,\"side\":\"inside\",\"intensity\":3,\"count\":4}}", "{\"enabled\":false,\"type\":\"border\",\"fadeDuration\":30,\"params\":{\"width\":4,\"color\":\"#e63946\",\"opacity\":1,\"radius\":2,\"glowColor\":\"#102030\",\"speed\":400,\"side\":\"inside\"}}", "{\"enabled\":true,\"type\":\"glow\",\"fadeDuration\":30,\"params\":{\"width\":9,\"color\":\"#00ff80\",\"opacity\":0.5,\"radius\":7,\"glowColor\":\"#ffffff\",\"speed\":100,\"side\":\"inside\",\"intensity\":3,\"count\":4}}"]
var t


func _same(got: Variant, expected_json: String) -> bool:
	return JSON.parse_string(NetUtil.to_json(got)) == JSON.parse_string(expected_json)


func test_merge_runtime_golden() -> void:
	var partial := []
	for i in 18:
		partial.append(i != 1 and i != 4 and i != 12)
	var off := []
	for i in 18:
		off.append(false)
	var maps := [null, partial, off, [true]]
	for i in maps.size():
		t.ok(_same(A.merge_runtime(LOCAL, REMOTE, maps[i]), EXPECTED[i]), "mergeArtnetBorderRuntime map #%d" % i)
	t.ok(_same(A.merge_runtime({"params": {}}, {"params": {"color": "bad"}}, null), '{"params":{"side":"inside","color":"#e63946","glowColor":"#e63946"}}'), "bad colours → default red")


func test_map_and_sync() -> void:
	t.eq(A.normalize_map([false, 0, null, "x"]), [false] + [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true], "only explicit false")
	t.eq(A.LABELS.size(), A.COUNT, "18 labels")
	var slot := {"artnetListenEnabled": false, "type": "border", "params": {"width": 1}, "slices": [{"x": 0}], "borderPresets": [1]}
	t.eq(A.apply_sync(slot, REMOTE), slot, "not listening → ignored")
	slot["artnetListenEnabled"] = true
	var got: Dictionary = A.apply_sync(slot, REMOTE)
	t.eq(got.type, "glow", "listening → runtime merged")
	t.eq(got.slices, [{"x": 0}], "slices kept")
	t.eq(got.borderPresets, [1], "presets kept")
	t.eq(A.apply_sync(null, REMOTE), null, "unconfigured screen untouched")
