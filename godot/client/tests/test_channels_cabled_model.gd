extends RefCounted
## WO-1029 plan 07 (C12 / C2): the confirm text of the "Channels only for the screens cabled here" switch, and the
## Local use jack (devices_model.gd slot, cable_rules.gd any number of cables).

const M := preload("res://features/devices/channels_cabled_model.gd")
const DM := preload("res://features/devices/devices_model.gd")
const CR := preload("res://features/devices/cable_rules.gd")
var t


static func _plan() -> Dictionary:
	return {"enable": true, "current": false,
		"removed": [{"label": "to zoom", "ch": [4], "reason": "cabled nowhere"}, {"label": "PGM/PRV 3", "ch": [5, 6], "reason": "cabled on highascg5867"}],
		"added": [], "kept": ["PGM/PRV 1"],
		"renumbered": [{"label": "DeckLink 1", "from": 9, "to": 4}],
		"state": {"dropped": 3, "references": 1},
		"external": ["REST / AMCP scripts that address a channel by number"],
		"refusals": [{"code": "cabled_nowhere", "forceable": true, "message": "to zoom is cabled nowhere: give it a Local use cable."}],
		"warnings": [{"code": "caspar_down", "message": "Caspar is not connected"}, {"code": "hot_backup", "message": "Hot backup is enabled."}]}


func test_endpoint_is_local_or_through_the_relay() -> void:
	t.eq(M.endpoint(), "/api/cluster/channels-where-cabled", "this server")
	t.eq(M.endpoint("a b"), "/api/cluster/peers/a%20b/relay/api/cluster/channels-where-cabled", "a linked server by id")


func test_state_line() -> void:
	t.eq(M.is_on({"on": true}), true, "on")
	t.eq(M.is_on({"on": false}), false, "off")
	t.eq(M.is_on({}), null, "an older build has no answer")
	t.eq(M.state_line({"on": false}), "Off: every screen has channels here.", "off line")
	t.ok(M.state_line(null).contains("older build"), "unknown")


func test_confirm_text_names_what_disappears_is_renumbered_and_external() -> void:
	var s := M.confirm_text(_plan(), "highascg7579")
	t.ok(s.begins_with("highascg7579: channels only for the screens cabled here"), "title")
	t.ok(s.contains("• to zoom (ch 4): cabled nowhere"), "removed row")
	t.ok(s.contains("• PGM/PRV 3 (ch 5, 6): cabled on highascg5867"), "removed row with a server")
	t.ok(s.contains("Unchanged: PGM/PRV 1"), "kept")
	t.ok(s.contains("• DeckLink 1: 9 → 4"), "renumbered")
	t.ok(s.contains("3 entries of removed channels dropped, 1 reference(s) renumbered"), "state")
	t.ok(s.contains("Refused: to zoom is cabled nowhere: give it a Local use cable."), "refusal")
	t.ok(s.contains("Note: Hot backup is enabled."), "warning")
	t.ok(not s.contains("Caspar is not connected"), "the caspar_down note is not shown")
	t.ok(s.contains("cannot renumber") and s.contains("REST / AMCP scripts"), "external notes")
	t.ok(s.ends_with("press Apply to restart Caspar with the new channels."), "nothing restarts now")


func test_confirm_text_when_switching_off() -> void:
	var s := M.confirm_text({"enable": false, "removed": [], "added": [{"label": "PGM/PRV 3", "ch": [5, 6]}]}, "")
	t.ok(s.begins_with("This server: channels for every screen again"), "off title")
	t.ok(s.contains("get channels here:") and s.contains("• PGM/PRV 3 (ch 5, 6)"), "added rows")


func test_force_and_block() -> void:
	t.eq(M.forceable(_plan()), true, "only forceable refusals: Switch anyway")
	t.eq(M.blocked(_plan()), false, "not blocked")
	var p := _plan()
	p.refusals.append({"code": "peer_caps", "message": "x"})
	t.eq([M.forceable(p), M.blocked(p)], [false, true], "a hard refusal blocks")
	t.eq([M.forceable({}), M.blocked({})], [false, false], "no refusals: plain Switch")


func test_result_line() -> void:
	t.ok(M.result_line({"ok": true, "data": {"ok": true}}).contains("Press Apply"), "switched")
	t.eq(M.result_line({"ok": true, "data": {"ok": true, "noop": true}}), "Already in that state.", "noop")
	t.eq(M.result_line({"ok": false, "data": {"error": "409 x"}}), "Not switched: 409 x", "refused")


func _view(with_jack: bool) -> Dictionary:
	var conns := [{"id": "dst_in_a", "deviceId": "destinations", "kind": "destination_in", "externalRef": "a"},
		{"id": "dst_in_b", "deviceId": "destinations", "kind": "destination_in", "externalRef": "b"},
		{"id": "gpu_p0", "deviceId": "caspar_host", "kind": "gpu_out"}]
	if with_jack:
		conns.append({"id": "local_use", "deviceId": "caspar_host", "kind": "local_use", "label": "Local use", "index": 0})
	return {"graph": {"connectors": conns, "edges": [{"id": "e1", "sourceId": "dst_in_a", "sinkId": "local_use"}, {"id": "e2", "sourceId": "dst_in_b", "sinkId": "local_use"}, {"id": "e3", "sourceId": "dst_in_a", "sinkId": "gpu_p0"}]},
		"screenDestinations": {"destinations": [{"id": "a", "label": "to zoom"}, {"id": "b", "label": "Draft"}]}}


func test_local_use_slot_only_when_the_server_has_the_jack() -> void:
	var titles := func(m: Dictionary) -> Array: return m.slots.map(func(s: Dictionary) -> String: return s.title)
	t.ok(not titles.call(DM.build(_view(false))).has("Local use"), "no jack: no slot")
	var m := DM.build(_view(true))
	t.ok(titles.call(m).has("Local use"), "jack: slot")
	var slot: Dictionary = m.slots.filter(func(s: Dictionary) -> bool: return s.kind == "local_use")[0]
	t.eq(slot.items.map(func(i: Dictionary) -> String: return i.id), ["local_use"], "one jack")
	t.ok(str(slot.hint).contains("zoom, virtual camera, previews"), "hint names the uses")
	var dest: Dictionary = m.destinations[0]
	t.ok(dest.links.any(func(l: String) -> bool: return l.ends_with("Local use")), "the destination card says where it is cabled: Local use")


func test_local_use_takes_any_number_of_cables_and_gpu_still_one() -> void:
	var p := _view(true)
	t.eq(CR.sink_conflict(p, "local_use"), {}, "Local use is never occupied")
	t.eq(CR.sink_conflict(p, "gpu_p0").get("id"), "e3", "a GPU port still is")
	t.eq(CR.role(CR.connector_by_id(p, "local_use")), "caspar_out", "cabled like an output")
	t.eq(CR.order_edge(p, "local_use", "dst_in_a"), {"sourceId": "dst_in_a", "sinkId": "local_use"}, "either click order")
	t.eq(CR.friendly_label(p, "local_use"), "Local use", "status label")
	t.eq(CR.sink_needs_restart({"kind": "local_use"}, false), false, "the server decides the restart")
