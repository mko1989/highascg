extends RefCounted
## WO-1039 — PixelHue Device panel: request bodies, validation, labels (device_model.gd).
const M := preload("res://features/pixelhue/device_model.gd")
var t

const NODE := {"name": "System1", "beacon": 1, "fanMode": 2, "genlock": {"type": 0, "sourceId": 0}}


func test_no_change_no_body() -> void:
	var form := {"name": "System1", "beacon": 1, "fan": 2, "genlock_type": 0, "genlock_input": 5}
	t.eq(M.device_changes(NODE, form), {}, "an untouched form changes nothing")


func test_changes_only_differences() -> void:
	var form := {"name": "Stage", "beacon": 0, "fan": 2, "genlock_type": 2, "genlock_input": 25}
	t.eq(M.device_changes(NODE, form), {"name": "Stage", "beacon": 0, "genlock": {"type": 2, "sourceId": 25}}, "name, beacon, genlock")
	t.eq(M.device_changes(NODE, {"name": "System1", "beacon": -1, "fan": -1, "genlock_type": -1}), {}, "absent controls skipped")


func test_name_rules() -> void:
	t.eq(M.validate_name("OK"), "", "plain")
	t.ok(M.validate_name("  ") != "", "blank")
	t.ok(M.validate_name("x".repeat(33)) != "", "33 bytes")
	t.ok(M.validate_name("é".repeat(17)) != "", "17 two-byte chars = 34 bytes")


func test_mode_and_layer_bodies() -> void:
	t.eq(M.mode_body(8), {"workMode": 8, "confirmModeChange": true}, "mode needs the confirm flag")
	t.eq(M.layer_body(0), {"layerMode": 0}, "layer")
	t.eq(M.layer_text({"main": 4, "pip": 4, "hdr": false}), "4 MAIN layers · 4 PIP layers · HDR not supported", "layer text")


func test_clock() -> void:
	t.eq(M.zone_label({"offset": -300, "name": "America/Chicago"}), "(UTC-05:00) America/Chicago", "negative zone")
	t.eq(M.zone_label({"offset": 330, "name": "Asia/Kolkata"}), "(UTC+05:30) Asia/Kolkata", "half-hour zone")
	var ts := M.parse_wall_time("2026-11-11 14:30:00", 60)
	t.eq(M.wall_time(ts, 60), "2026-11-11 14:30:00", "round trip")
	t.eq(M.wall_time(0 + 946684800, 0), "2000-01-01 00:00:00", "epoch of range")
	t.eq(M.parse_wall_time("2026-11-11T14:30", 0), M.parse_wall_time("2026-11-11 14:30:00", 0), "T and no seconds")
	t.eq(M.parse_wall_time("nonsense", 0), -1, "garbage")
	t.eq(M.parse_wall_time("1999-01-01 00:00:00", 0), -1, "before 2000")
	t.eq(M.parse_wall_time("2026-13-01 00:00:00", 0), -1, "month 13")
	t.eq(M.clock_body(70, 5), {"time": {"timezone": 70, "timestamp": 5}}, "body")


func test_anti_static() -> void:
	var lim := {"min": 100, "max": 1000}
	t.eq(M.anti_static(1, "300", lim).body, {"antiStatic": {"enable": 1, "time": 300}}, "body")
	t.ok(not M.anti_static(1, "50", lim).ok, "below min")
	t.ok(not M.anti_static(1, "abc", lim).ok, "not a number")


func test_network_validation() -> void:
	t.ok(M.network(0, "192.168.0.7", "255.255.255.0", "192.168.0.1").ok, "good static")
	t.eq(M.network(1, "x", "", "").network, {"dhcp": 1, "ip": "", "netmask": "", "gateway": ""}, "dhcp blanks")
	t.eq(M.network(0, "192.168.0.300", "255.255.255.0", "192.168.0.1").error, "IP address must be an IPv4 address.", "octet range")
	t.eq(M.network(0, "192.168.0.7", "255.0.255.0", "192.168.0.1").error, "Subnet mask must be contiguous, e.g. 255.255.255.0.", "mask")
	t.eq(M.network(0, "192.168.0.0", "255.255.255.0", "192.168.0.1").error, "IP address cannot be the network or broadcast address.", "network addr")
	t.eq(M.network(0, "192.168.0.7", "255.255.255.0", "10.0.0.1").error, "Gateway must be in the same subnet as the IP address.", "gateway subnet")
	t.eq(M.network(0, "192.168.0.7", "255.255.255.0", "192.168.0.7").error, "IP address and gateway must differ.", "same")
	t.eq(M.network(0, "01.2.3.4", "255.255.255.0", "1.2.3.1").error, "IP address must be an IPv4 address.", "leading zero")


func test_action_bodies_carry_confirmation() -> void:
	t.eq(M.restart_action(), {"action": "restart", "confirm": true}, "restart")
	t.eq(M.shutdown_action(), {"action": "shutdown", "confirm": true}, "shutdown")
	t.eq(M.factory_reset_action("network"), {"action": "factory-reset", "keep": "network", "confirm": "RESET"}, "reset")
	var net := {"dhcp": 0, "ip": "10.0.0.2", "netmask": "255.0.0.0", "gateway": "10.0.0.1"}
	t.eq(M.network_action(net), {"action": "network", "network": net, "confirm": true}, "network")
	t.ok("DHCP" in M.network_confirm({"dhcp": 1}), "dhcp confirm text")


func test_cards_and_facts() -> void:
	var rows := M.card_rows([{"slot": "Slot 0", "kind": "Input card", "name": "N", "modelId": 15728896, "ports": "", "online": 0}])
	t.eq(rows[0][2], "—", "no ports dash")
	t.eq(rows[0][3], "Offline", "offline")
	t.eq(M.facts({"node": {}, "device": {"model": "P20", "serial": "S", "host": "h", "port": 8088.0}})[3], ["Address", "h:8088"], "address")
	t.eq(M.fan_label(2), "High performance", "fan")
	t.eq(M.genlock_label(2), "Input", "genlock")


func test_self_test() -> void:
	t.eq(M.self_test_summary({"total": 0, "abnormal": 0, "checkType": 0}), "Power-on check: No result stored.", "empty")
	t.eq(M.self_test_summary({"total": 8, "abnormal": 2, "checkType": 1}), "Device test: 2 of 8 checks abnormal", "bad")
	var rows := M.self_test_rows({"items": [{"name": "Fan", "index": 0, "value": "ok", "ok": true}, {"name": "Temp", "index": 1, "value": "90", "ok": false}]})
	t.eq(rows[0], ["Temp 2", "90 · abnormal", false], "abnormal first, 1-based index")
	t.eq(rows[1][0], "Fan", "index 0 has no number")
	t.eq(M.self_test_done({"abnormal": 0}), "Self-test finished: all normal.", "done")


func test_backup() -> void:
	var st := {"sameCapacity": true, "pairs": [{"id": 1, "primary": 2, "backup": 4}], "inputs": [
		{"id": 2, "name": "A", "capacity": 2, "signal": 0}, {"id": 4, "name": "B", "capacity": 2, "signal": 1},
		{"id": 13, "name": "C", "capacity": 2, "signal": 1}, {"id": 25, "name": "D", "capacity": 1, "signal": 1},
		{"id": 38, "name": "E", "capacity": 2, "signal": 0}]}
	t.eq(M.backup_free(st).size(), 3, "paired inputs are not free")
	var c := M.backup_candidates(st, 13)
	t.eq(c.size(), 1, "same capacity only")
	t.eq(c[0].id, 38, "E matches C")
	st.sameCapacity = false
	t.eq(M.backup_candidates(st, 13).size(), 2, "not larger: D and E")
	t.eq(M.backup_candidates(st, 25).size(), 0, "nothing not larger than a capacity-1 primary")
	t.eq(M.backup_add(13, 38), {"action": "add", "primary": 13, "backup": 38}, "add")
	t.eq(M.backup_update_auto(1, false), {"action": "update", "id": 1, "auto": false}, "auto")
	t.eq(M.backup_update_using(1, "backup"), {"action": "update", "id": 1, "using": "backup"}, "using")
	t.eq(M.backup_remove(1), {"action": "remove", "id": 1}, "remove")
	t.eq(M.backup_primary_first(true), {"action": "primary-first", "primaryFirst": 1}, "pf")
	t.eq(M.backup_enable(0), {"action": "enable", "enable": 0}, "enable")
	t.eq(M.backup_input_label({"name": "X", "capacity": 2, "signal": 0}), "X · 4K · no signal", "label")
	t.eq(M.backup_using_options({"using": "none", "primaryName": "P", "backupName": "B"}).size(), 3, "none option")
	t.eq(M.backup_idle_note({"pairs": []}), "0 pairs stored. Turn backup on to edit pairs.", "idle")
