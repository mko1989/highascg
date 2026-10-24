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


func test_link_line_only_when_one_way() -> void:
	t.eq(M.link_line({"name": "B", "linked_back": true}), "", "both ways")
	t.eq(M.link_line({"name": "B", "linked_back": null}), "", "not known yet / older server")
	t.eq(M.link_line({"name": "B"}), "", "field missing (older server)")
	t.eq(M.link_line({"name": "B", "linked_back": false}), "One-way: B does not list this server, asking it again.", "no reason yet")
	t.eq(M.link_line({"name": "B", "linked_back": false, "link_back_error": "it needs sign-in"}), "One-way: B does not list this server (it needs sign-in).", "refused")


func test_link_line_waits_for_an_invite() -> void:  # WO-739
	t.eq(M.link_line({"name": "B", "linked_back": false, "link_pending": true, "link_back_error": "waiting for B to accept"}),
		"Waiting for B to accept the link (Devices → Servers there).", "an invite there, not a refusal")
	t.eq(M.link_line({"name": "B", "linked_back": true, "link_pending": false}), "", "accepted")


func test_invite_line_and_devices_title() -> void:  # WO-739
	t.eq(M.invite_line({"id": "boxA", "name": "highascg5867", "host": "192.168.0.4"}), "highascg5867 (192.168.0.4) asks to link with this server.", "who and where")
	t.eq(M.invite_line({"id": "boxA"}), "boxA asks to link with this server.", "no name / host")
	t.eq(M.devices_title({"invites": []}), "Devices", "none")
	t.eq(M.devices_title({"invites": [{"id": "a"}]}), "Devices (1 invite)", "one")
	t.eq(M.devices_title({"invites": [{"id": "a"}, {"id": "b"}]}), "Devices (2 invites)", "two")
	t.eq(M.devices_title({"peers": []}), "Devices", "an older server (no invites)")
	t.eq(M.devices_title(null), "Devices", "no snapshot")


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


func test_show_line() -> void:  # WO-746
	t.eq(M.show_line({"on": false}), "", "off: no line")
	t.eq(M.show_line(null), "", "older server: no line")
	t.eq(M.show_line({"on": true, "blocked": "hot-backup pair"}), "Show not shared: this server is in a hot-backup pair.", "blocked")
	t.eq(M.show_line({"on": true, "role": "master", "peers": {"b": {"in_sync": true}}}), "Show shared from here · every server in step", "master")
	t.eq(M.show_line({"on": true, "role": "master", "peers": {"b": {"in_sync": false}, "c": {"in_sync": true}}}), "Show shared from here · 1 server(s) not in step", "master, one behind")
	t.eq(M.show_line({"on": true, "role": "follower", "in_sync": true}), "Show shared from the master · in step", "follower")
	t.eq(M.show_line({"on": true, "role": "follower", "pending": true}), "Show shared from the master · sending your edit", "edit on its way")
	t.eq(M.show_line({"on": true, "role": "alone"}), "Show sharing on · waiting for a master", "no master")
	var c := {"on": true, "role": "follower", "in_sync": true, "conflict": {"count": 2, "file": "projects/_cluster/x.conflict-1.json"}}
	t.eq(M.show_line(c), "Show shared from the master · in step · 2 item(s) edited on two servers at once: the master's kept, this server's saved as projects/_cluster/x.conflict-1.json", "conflict")
	t.ok(M.show_warns(c) and M.show_warns({"caspar_apply": true}) and not M.show_warns({"on": true, "role": "master"}), "warns only when the operator must act")


func test_does_text_says_what_a_linked_server_resolves_to() -> void:  # WO-723 (was R1 ticks)
	var media := {"tracking": false, "detection": false, "zones": false, "auto": false, "presenters": false,
		"lighting": false, "ptz": false, "artnet_in": true, "accept_remote": true}
	t.eq(M.does_text(media), "", "a media-only server: nothing to say (its destinations are listed above)")
	var tracker := media.duplicate()
	for k in ["tracking", "lighting", "ptz"]:
		tracker[k] = true
	t.eq(M.does_text(tracker), "Does: tracking · lights out · PTZ out", "what it resolves to")
	var locked := tracker.duplicate()
	locked["accept_remote"] = false
	t.eq(M.does_text(locked), "Does: tracking · lights out · PTZ out · refuses remote actions", "the D3 lock")
	t.eq(M.does_text(null), "", "an older server sent no duties")
	t.eq(M.does_text({"detection": true, "lighting": true}), "", "an older server's R1 ticks are not what it does")
	t.ok(not str(M.does_text(tracker)).contains("Roles"), "never the word Roles")


func test_sender_items_auto_first_then_every_server() -> void:  # WO-723
	var view := {"servers": [{"fp": "aaaa", "name": "media", "self": true, "online": true},
		{"fp": "bbbb", "name": "tracker", "self": false, "online": true}, {"fp": "cccc", "name": "spare", "self": false, "online": false}],
		"senders": {"lighting": {"by": "", "auto_name": "tracker"}, "ptz": {"by": "cccc", "auto_name": "tracker"},
			"artnet_in": {"by": "", "auto_name": "*"}}}
	t.eq(M.sender_items(view, "lighting").map(func(i: Dictionary) -> String: return i.text),
		["Auto — tracker", "media (this server)", "tracker", "spare (offline)"], "Auto names who it picks")
	t.eq(M.sender_items(view, "lighting").map(func(i: Dictionary) -> String: return i.by), ["", "aaaa", "bbbb", "cccc"])
	t.eq(M.sender_index(view, "lighting"), 0, "Auto")
	t.eq(M.sender_index(view, "ptz"), 3, "the chosen server, offline or not")
	t.eq(M.sender_items(view, "artnet_in")[0].text, "Auto — every server", "the lighting input: every server")
	t.eq(M.sender_items({"servers": [{"fp": "aaaa", "name": "solo", "self": true}], "senders": {}}, "lighting"), [], "one box: no picker")
	t.eq(M.sender_items({"servers": []}, "ptz"), [], "unlinked: no picker")
	t.eq(M.sender_items(null, "ptz"), [], "no answer: no picker")
	var old := view.duplicate(true)
	old.servers[1]["refused"] = "unknown action \"cluster.senders\""
	var it: Dictionary = M.sender_items(old, "lighting")[2]
	t.eq(it.text, "tracker (not in sync)", "an older server that refused the choice")
	t.ok(str(it.tip).contains("unknown action"), "the reason is the item's tooltip")
	t.eq(M.sender_items(view, "lighting")[2].tip, "", "in sync: no tooltip")
	var gone := view.duplicate(true)
	gone.senders.lighting.by = "dddd"
	t.eq(M.sender_index(gone, "lighting"), 0, "a server no longer listed → Auto")
