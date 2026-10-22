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
