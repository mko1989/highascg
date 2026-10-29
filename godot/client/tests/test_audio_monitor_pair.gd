extends RefCounted
## WO-801 — the headphone pair picker on the PRV master strip: its choices (Mix + one pair per two bus channels),
## the request it sends (POST /api/audio/monitor-source {pair}), the stored console state it shows (`monitorPair`,
## absent = mix), and the simulated server's answer.

const AA := preload("res://features/audio/audio_actions.gd")
const Strip := preload("res://features/audio/audio_strip.gd")
const Demo := preload("res://core/demo/demo_server.gd")
const PRV := {"key": "prv:2", "ch": 2.0, "label": "PRV 1 Master", "v": 1.0, "isMaster": true, "isPreview": true}
const PGM := {"key": "pgm:1", "ch": 1.0, "label": "PGM 1 Master", "v": 1.0, "isMaster": true}
var t


func test_pairs_text_and_request() -> void:
	t.eq(AA.monitor_pairs(2), ["mix", "1+2", "3+4", "5+6", "7+8"], "stereo bus: at least 4 pairs")
	t.eq(AA.monitor_pairs(8).size(), 5, "8ch bus: Mix + 4 pairs")
	t.eq(AA.monitor_pairs(12).size(), 7, "12ch bus: Mix + 6 pairs")
	t.eq(AA.monitor_pairs(16).size(), 9, "16ch bus: Mix + 8 pairs")
	t.eq(AA.monitor_pairs(16)[-1], "15+16", "last pair")
	t.eq(AA.monitor_pair_text("mix"), "HP Mix")
	t.eq(AA.monitor_pair_text("3+4"), "HP 3+4")
	t.eq(AA.monitor_pair({}), "mix", "no stored pair = mix")
	t.eq(AA.monitor_pair({"monitorPair": "5+6"}), "5+6")
	t.eq(AA.monitor_pair({"monitorPair": "4+5"}), "mix", "an odd pair is not a pair")
	t.eq(AA.monitor_pair_request("3+4"), ["POST", "/api/audio/monitor-source", {"pair": "3+4"}])


func test_prv_master_gets_the_picker() -> void:
	var s = Strip.new()
	s.setup(PRV, 2, false)
	s.enable_monitor_pairs(AA.monitor_pairs(8))
	var pickers: Array = s.find_children("*", "OptionButton", true, false)
	t.eq(pickers.size(), 1, "one picker on the PRV master")
	var o: OptionButton = pickers[0]
	t.eq(o.item_count, 5)
	t.eq(o.get_item_text(0), "HP Mix")
	t.eq(o.get_item_text(2), "HP 3+4")
	t.eq(o.focus_mode, Control.FOCUS_NONE, "never steals arrow-key focus")
	s.enable_monitor_pairs(AA.monitor_pairs(16))
	t.eq(s.find_children("*", "OptionButton", true, false).size(), 1, "enabling twice keeps one picker")
	s.set_monitor_pair("3+4")
	t.eq(o.selected, 2, "the stored pair is shown")
	t.eq(s.monitor_pair(), "3+4")
	s.set_monitor_pair("13+14")
	t.eq(o.get_item_text(o.selected), "HP 13+14", "a stored pair wider than the bus list still shows")
	var got := []
	s.monitor_pair_selected.connect(func(p: String) -> void: got.append(p))
	o.item_selected.emit(1)
	t.eq(got, ["1+2"], "picking emits the pair")
	s.free()


func test_pgm_master_has_no_picker() -> void:
	var s = Strip.new()
	s.setup(PGM, 2, false)
	s.set_monitor_pair("3+4")
	t.eq(s.find_children("*", "OptionButton", true, false).size(), 0, "no picker on a PGM master")
	t.eq(s.monitor_pair(), "", "no picker → no pair")
	s.enable_monitor_pairs([])
	t.eq(s.find_children("*", "OptionButton", true, false).size(), 0, "no monitor output → no picker")
	s.free()


func test_demo_server_stores_the_pair() -> void:
	var d: RefCounted = Demo.new(Demo.load_dir(Demo.DATA_DIR))
	var r: Dictionary = d.handle(HTTPClient.METHOD_POST, "/api/audio/monitor-source", {"pair": "3+4"})
	t.ok(r.ok, "demo answers the pair")
	t.eq(d.handle(HTTPClient.METHOD_GET, "/api/audio/mixer", null).data.get("monitorPair"), "3+4")
	d.handle(HTTPClient.METHOD_POST, "/api/audio/monitor-source", {"pair": "mix"})
	t.eq(d.handle(HTTPClient.METHOD_GET, "/api/audio/mixer", null).data.has("monitorPair"), false, "mix clears it")
