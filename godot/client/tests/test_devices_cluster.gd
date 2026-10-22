extends RefCounted
## WO-670 P2 — cluster_model.gd: a linked server's role per shared destination follows the cables on both servers.

const M := preload("res://features/devices/cluster_model.gd")
var t


static func _payload(cabled: Array) -> Dictionary:
	var conns := []
	var edges := []
	for did in ["pgm1", "side", "gui"]:
		conns.append({"id": "dst_in_" + did, "kind": "destination_in", "externalRef": did})
	for did in cabled:
		edges.append({"id": "e_" + did, "sourceId": "dst_in_" + did, "sinkId": "gpu_0"})
	edges.append({"id": "e_x", "sourceId": "somewhere", "sinkId": "gpu_1"})
	return {"graph": {"connectors": conns, "edges": edges},
		"screenDestinations": {"destinations": [{"id": "pgm1", "label": "PGM/PRV 1"}, {"id": "side", "label": "Side LED"}, {"id": "gui", "label": ""}]}}


func test_cabled_lists_destinations_with_a_cable() -> void:
	t.eq(M.cabled(_payload(["pgm1", "gui"])), {"pgm1": "PGM/PRV 1", "gui": "gui"}, "label, or the id when it has none")
	t.eq(M.cabled({}), {}, "an empty payload has none")


func test_roles_backup_when_cabled_on_both_extension_when_only_on_the_peer() -> void:
	var r := M.roles(_payload(["pgm1", "gui"]), _payload(["pgm1", "side"]))
	t.eq(r, [{"id": "pgm1", "label": "PGM/PRV 1", "role": "backup"}, {"id": "side", "label": "Side LED", "role": "extension"}], "per destination")
	t.eq(M.roles_text(r), "PGM/PRV 1: backup · Side LED: extension", "one line")
	t.eq(M.roles_text([]), "No destination cabled on this server.", "nothing cabled")


func test_facts_line() -> void:
	var p := {"host": "10.0.0.6", "port": 4200, "version": "2026.05.20", "role": "standalone", "program_channels": 2, "media_parity": "differs", "online": true}
	t.eq(M.facts(p), "10.0.0.6:4200 · 2026.05.20 · standalone · 2 program ch · media differs", "online")
	t.eq(M.facts({"host": "b", "port": 4300, "online": false, "error": "ECONNREFUSED"}), "b:4300 · media ? · offline: ECONNREFUSED", "offline")


func test_send_line() -> void:
	t.eq(M.send_line({}, ""), "", "never sent")
	t.eq(M.send_line({"media_send": {"state": "sending", "percent": 40}}, ""), "Sending media… 40 %", "progress")
	t.eq(M.send_line({"media_send": {"state": "done", "files": 3}}, ""), "Media sent (3 paths).", "done")
	t.eq(M.send_line({"media_send": {"state": "failed", "error": "SSH auth failed"}}, ""), "Media send failed: SSH auth failed", "failed")
	t.eq(M.send_line({"media_send": {"state": "done", "files": 1}}, "B has not linked this server"), "B has not linked this server", "a refusal wins")
	t.ok(M.sending({"media_send": {"state": "sending"}}), "sending")
	t.ok(not M.sending({}), "idle")


func test_master_line() -> void:
	t.eq(M.master_line({"epoch": 0}), "No master yet: Make master on the server that runs the show.", "none yet")
	t.eq(M.master_line({"epoch": 3, "is_master": true, "auto": true}), "Master: this server · epoch 3 · auto failover", "this one")
	var m := {"epoch": 2, "master": "bb", "master_id": "boxB", "auto": false, "succession": [{"key_id": "bb", "id": "boxB", "name": "Box B"}]}
	t.eq(M.master_line(m), "Master: Box B · epoch 2 · failover by hand", "a peer")
	t.eq(M.master_line({"epoch": 2, "master": "cc", "succession": []}), "Master: a server not linked here · epoch 2 · failover by hand", "unknown")
	t.ok(M.is_master(m, "boxB"), "card badge")
	t.ok(not M.is_master(m, "boxC"), "not that one")
	t.ok(not M.is_master({"epoch": 0, "master_id": ""}, ""), "no master → no badge")


func test_fanout_line() -> void:
	var snap := {"fanout": {"active": true, "peers": {
		"b": {"caspar": "10.0.0.2:5250", "connected": true, "sent": 7, "error": "", "caught_up": {"lines": 4},
			"destinations": [{"id": "d1", "label": "PGM/PRV 1", "pgm": [1, 11], "prv": [2, 12]}, {"id": "d2", "label": "LED", "pgm": [3, 1], "prv": null}]},
		"c": {"caspar": "10.0.0.3:5250", "connected": false, "sent": 0, "error": "", "destinations": []},
		"d": {"caspar": "10.0.0.4:5250", "connected": true, "sent": 0, "error": "no shared destination is cabled there", "destinations": []}}}}
	t.eq(M.fanout_line(snap, "b"), "Takes forwarded: PGM/PRV 1 (ch 1→11, 2→12), LED (ch 3→1) · 7 sent · caught up (4 lines)", "forwarding")
	t.eq(M.fanout_line(snap, "c"), "Takes not forwarded: its Caspar 10.0.0.3:5250 does not answer", "not connected")
	t.eq(M.fanout_line(snap, "d"), "Takes not forwarded: no shared destination is cabled there", "uncabled")
	t.ok(M.is_fanout_error(M.fanout_line(snap, "d")), "error colour")
	t.eq(M.fanout_line(snap, "x"), "", "unknown server")
	snap.fanout.peers.b.caught_up = {"lines": 0}
	t.eq(M.fanout_line(snap, "b"), "Takes forwarded: PGM/PRV 1 (ch 1→11, 2→12), LED (ch 3→1) · 7 sent", "nothing to catch up → no mention")
	t.eq(M.fanout_line({"fanout": {"active": false, "peers": {}}}, "b"), "", "not master → no line")
	t.eq(M.follow_note({"follows_master": true}), "PGM here is driven by the master: local PGM takes are skipped (PRV still works).", "follower")
	t.eq(M.follow_note({}), "", "not a follower")
