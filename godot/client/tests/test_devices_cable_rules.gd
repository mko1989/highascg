extends RefCounted
## WO-605 slice 2 — cable_rules.gd against golden values from the web modules (device-view-helpers.js,
## device-view-cable-resolve.js, device-view-cable-regrab.js, device-view-cable-messages.js,
## caspar-restart-dirty-policy.js) run under Node on one payload: tests/golden/devices_cable_rules.json.

const R := preload("res://features/devices/cable_rules.gd")
var t
var _g: Dictionary


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_cable_rules.json"))
	return _g


func _pick(c: Dictionary) -> Variant:
	if c.is_empty():
		return null
	return {"kind": c.get("kind"), "deviceId": c.get("deviceId"), "label": c.get("label"),
		"externalRef": c.get("externalRef"), "slot": R.d(c.get("gpuPhysical")).get("slotOrder")}


func test_connector_by_id_role_and_label() -> void:
	var g := _golden()
	for id in g.out.conn:
		var c := R.connector_by_id(g.payload, id)
		t.eq(_pick(c), g.out.conn[id], "connector " + id)
		t.eq(R.role(c), g.out.role[id], "role " + id)
		t.eq(R.friendly_label(g.payload, id), g.out.label[id], "label " + id)


func test_canonical_ids() -> void:
	var g := _golden()
	for id in g.out.canon:
		t.eq(R.canonical_id(g.payload, id), g.out.canon[id], "canonical " + id)


func test_order_edge_both_click_orders() -> void:
	var g := _golden()
	for row in g.out.order:
		var want: Variant = row[2]
		var got := R.order_edge(g.payload, row[0], row[1])
		t.eq(got if not got.is_empty() else null, want, "order %s → %s" % [row[0], row[1]])


func test_sink_conflict_per_physical_socket() -> void:
	var g := _golden()
	for sink in g.out.conflict:
		var e := R.sink_conflict(g.payload, sink)
		t.eq(e.get("id") if not e.is_empty() else null, g.out.conflict[sink], "conflict " + sink)


func test_regrab_pick_plan_rollback() -> void:
	var g := _golden()
	for c in g.out.regrab:
		var what := "%s@%s→%s" % [c.sel, c.at, c.target]
		var grab := R.pick_regrab(g.payload.graph.edges, c.at, c.sel)
		t.eq(grab if not grab.is_empty() else null, c.grab, "grab " + what)
		var plan := R.plan_regrab(g.payload, grab, c.target)
		t.eq(plan, c.plan, "plan " + what)
		var rb := R.regrab_rollback(grab)
		t.eq(rb if not rb.is_empty() else null, c.rollback, "rollback " + what)
		t.eq(R.describe_restore(plan), c.text, "text " + what)


func test_endpoints_self_loop_is_sink_and_idless_skipped() -> void:
	var g := _golden()
	var edges: Array = g.payload.graph.edges.duplicate()
	edges.append({"id": "loop", "sourceId": "x", "sinkId": "x"})
	edges.append({"sourceId": "x", "sinkId": "y"})
	t.eq(R.endpoints_at(edges, "x"), g.out.endpoints, "endpoints at x")


func test_rejection_messages() -> void:
	var g := _golden()
	for raw in g.out.msg:
		t.eq(R.describe_rejection(raw), g.out.msg[raw][0], "describe '%s'" % raw)
		t.eq(R.is_unknown_connector_error(raw), g.out.msg[raw][1], "unknown '%s'" % raw)


func test_restart_policy() -> void:
	var g := _golden()
	for row in g.out.restart:
		t.eq(R.sink_needs_restart({"kind": row[0]}, row[1]), row[2], "restart %s ded=%s" % [row[0], row[1]])
	t.eq([R.dedicated_streaming({"streamingChannel": {"dedicatedOutputChannel": "true"}}),
		R.dedicated_streaming({"streamingChannel": {}}), R.dedicated_streaming(null)], g.out.ded, "dedicated")


func test_can_start_and_floats_as_ids() -> void:
	var g := _golden()
	t.ok(R.can_start(g.payload, "dst_in_dst_a"), "destination starts a cable")
	t.ok(R.can_start(g.payload, "gpu_p0"), "an output starts a cable too")
	t.ok(not R.can_start(g.payload, "dlsdi_2"), "a DeckLink input cannot")
	t.eq(R.s(2.0), "2", "JSON float id")
	t.eq(R.s(null), "", "null")
