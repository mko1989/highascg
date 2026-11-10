extends RefCounted
## WO-1029 — core/handover_model.gd: the remote client's handover decision (contract rules 1-8).

const M := preload("res://core/handover_model.gd")
var t

const B := "http://192.168.0.4:4200"
const C := "http://192.168.0.10:4200"
const D := "http://192.168.0.11:4200"


func _state(over := {}) -> Dictionary:
	var s := {"local": false, "now": 1000.0, "ws_down_since": 990.0, "http_down_since": 992.0,
		"box": {"id": "boxA", "host": "192.168.0.4"},
		"targets": [{"id": "boxB", "name": "boxB", "origin": C}],
		"answers": {C: {"ok": true, "auth": true, "is_master": true, "settled": true, "peers": []}},
		"busy": false, "last_move": -1.0, "home": {}, "home_up": false}
	s.merge(over, true)
	return s


func test_on_box_client_never_moves() -> void:
	t.eq(M.decide(_state({"local": true})).action, "stay", "loopback origin: stay, even with a master target")
	t.eq(M.decide(_state({"local": true, "home": {"origin": B, "name": "A"}, "home_up": true})).action, "stay", "and no return offer")
	var cfg := FileAccess.get_file_as_string("res://app/handover_watch.gd")
	t.ok(cfg.contains("if Config.demo or Platform.is_local_origin(Config.origin)"), "the watcher does not even run on the box")


func test_master_target_moves() -> void:
	var d := M.decide(_state())
	t.eq(d.action, "move", "box silent 8 s, target is master")
	t.eq(d.target.origin, C, "to the target")


func test_not_silent_long_enough() -> void:
	t.eq(M.decide(_state({"now": 995.0})).action, "stay", "silent 3 s: not yet")
	t.eq(M.decide(_state({"ws_down_since": -1.0})).action, "stay", "the WS still answers")
	t.eq(M.decide(_state({"http_down_since": -1.0})).action, "stay", "HTTP still answers")


func test_target_lists_old_box_offline_moves() -> void:
	var a := {"ok": true, "auth": true, "is_master": false, "settled": true, "peers": [{"id": "boxA", "host": "192.168.0.4", "online": false}]}
	t.eq(M.decide(_state({"answers": {C: a}})).action, "move", "follower that lists the old box offline")
	a.peers = [{"id": "other", "host": "192.168.0.4", "online": false}]
	t.eq(M.decide(_state({"answers": {C: a}})).action, "move", "matched by host too")
	a.peers = [{"id": "boxA", "host": "192.168.0.4", "online": true}]
	t.eq(M.decide(_state({"answers": {C: a}})).action, "offer", "lists it online: no confirmation")


func test_unconfirmed_offers_never_moves() -> void:
	var a := {"ok": true, "auth": true, "is_master": false, "settled": true, "peers": []}
	var d := M.decide(_state({"answers": {C: a}}))
	t.eq(d.action, "offer", "targets answer, none confirms")
	t.eq(d.target.origin, C, "offer names the target")
	t.ok(d.cue.contains("is not answering from here") and d.cue.contains("continue on"), "offer text")
	a = {"ok": true, "auth": false}
	t.eq(M.decide(_state({"answers": {C: a}})).action, "offer", "a target that wants a password is not a confirmation")
	a = {"ok": true, "auth": true, "is_master": true, "settled": false, "peers": []}
	t.eq(M.decide(_state({"answers": {C: a}})).action, "offer", "an unsettled master does not confirm")


func test_no_target_answers_stays() -> void:
	t.eq(M.decide(_state({"answers": {}})).action, "stay", "nobody answered")
	t.eq(M.decide(_state({"answers": {C: {"ok": false}}})).action, "stay", "failed probe")
	t.eq(M.decide(_state({"targets": []})).action, "stay", "no learned targets")


func test_prefers_master() -> void:
	var fol := {"ok": true, "auth": true, "is_master": false, "settled": true, "peers": [{"id": "boxA", "host": "192.168.0.4", "online": false}]}
	var mas := {"ok": true, "auth": true, "is_master": true, "settled": true, "peers": []}
	var s := _state({"targets": [{"id": "f", "name": "f", "origin": D}, {"id": "m", "name": "m", "origin": C}], "answers": {D: fol, C: mas}})
	t.eq(M.decide(s).target.origin, C, "the master, though listed second")


func test_hold_after_move() -> void:
	t.eq(M.decide(_state({"last_move": 980.0})).action, "stay", "20 s after a move: no automatic move")
	t.eq(M.decide(_state({"last_move": 960.0})).action, "move", "40 s after: allowed again")


func test_busy_operator_waits() -> void:
	var d := M.decide(_state({"busy": true}))
	t.eq(d.action, "stay", "mid-drag / modal: no move")
	t.eq(d.waiting, true, "and says it waits")
	t.ok(d.cue.contains("waiting"), "cue shows waiting…")
	t.eq(M.decide(_state({"busy": false})).action, "move", "moves once the operator is free")


func test_first_box_back_offers_return() -> void:
	var home := {"origin": B, "name": "boxA"}
	var s := _state({"ws_down_since": -1.0, "http_down_since": -1.0, "home": home, "home_up": true})
	var d := M.decide(s)
	t.eq(d.action, "offer_return", "healthy here, first box answers")
	t.eq(d.target.origin, B, "back to it")
	t.eq(d.cue, "boxA is back — return?", "text")
	s.home_up = false
	t.eq(M.decide(s).action, "stay", "first box still away: stay")


func test_only_reported_targets_are_used() -> void:
	var s := _state({"targets": [], "answers": {C: {"ok": true, "auth": true, "is_master": true, "settled": true, "peers": []}}})
	t.eq(M.decide(s).action, "stay", "an answer from an address the box never reported is ignored")
	var learned := M.learn_targets({"peers": [{"id": "boxB", "name": "B", "host": "192.168.0.10", "port": 4200, "online": true}, {"id": "x"}]})
	t.eq(learned, [{"id": "boxB", "name": "B", "origin": C}], "only peers with a host, from the box's own list")
	t.eq(M.learn_targets(null), [], "garbage")


func test_learned_list_survives_restart() -> void:
	var cfg := ConfigFile.new()
	var targets := [{"id": "boxB", "name": "B", "origin": C}]
	M.store_cfg(cfg, B, {"id": "boxA", "host": "192.168.0.4"}, targets)
	var back := M.load_cfg(cfg, B)
	t.eq(back.targets, targets, "targets")
	t.eq(back.box.id, "boxA", "identity")
	t.eq(M.load_cfg(cfg, "http://other:4200").targets, [], "keyed by origin")
	t.eq(M.parse("not json").targets, [], "garbage parses to nothing")


func test_answer_reading_and_cue() -> void:
	var a := M.read_answer({"self": {"id": "boxB"}, "master": {"is_master": true, "settled": true},
		"peers": [{"id": "boxA", "host": "192.168.0.4", "online": false}]})
	t.eq(a.is_master, true, "master")
	t.eq(M.confirms(a, {"id": "boxA", "host": "x"}), true, "confirms")
	t.eq(M.box_of({"self": {"id": "boxA"}}, B), {"id": "boxA", "host": "192.168.0.4"}, "box identity")
	t.ok(M.cue_text("B", "A", 3600.0 * 12).begins_with("on B — handed over from A "), "cue text")
