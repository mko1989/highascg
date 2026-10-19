extends RefCounted
## WO-605 — devices_model.gd: output layer parsing, PGM/PRV anchor keys, GPU/DeckLink/rear-panel build from a device-view payload

const M := preload("res://features/devices/devices_model.gd")
const CASPAR := "caspar_host"
var t


## Small payload modelled on GET /api/device-view: one operator-GUI destination (plain connector), one pgm_prv
## destination (two halves), one host_channel destination (must be skipped), two GPU sockets given out of slot order.
func _fixture() -> Dictionary:
	return {
		"graph": {
			"connectors": [
				{"id": "dst_in_dst_op_1", "deviceId": "destinations", "kind": "destination_in", "label": "Operator GUI", "externalRef": "dst_op_1"},
				{"id": "dst_in_dst_pv_1", "deviceId": "destinations", "kind": "destination_in", "label": "Main LED", "externalRef": "dst_pv_1"},
				{"id": "gpu_p0", "deviceId": CASPAR, "kind": "gpu_out", "label": "GPU 0", "externalRef": "DP-0"},
				{"id": "gpu_p1", "deviceId": CASPAR, "kind": "gpu_out", "label": "GPU 1", "externalRef": "DP-2"},
				{"id": "dlsdi_2", "deviceId": CASPAR, "kind": "decklink_io", "index": 1, "label": "DeckLink 2", "externalRef": "2"},
				{"id": "dlsdi_1", "deviceId": CASPAR, "kind": "decklink_io", "index": 0, "label": "DeckLink 1", "externalRef": "1"},
			],
			"edges": [
				{"id": "e_op_gpu_p1", "sourceId": "dst_in_dst_op_1", "sinkId": "gpu_p1"},
				{"id": "e_pv_gpu_p0", "sourceId": "dst_in_dst_pv_1", "sinkId": "gpu_p0", "note": "{\"outputLayer\":2}"},
			],
		},
		"live": {"gpu": {"physicalMap": {"ports": [
			{"physicalPortId": "gpu_p1", "slotOrder": 1, "pair": {"dpA": "DP-2", "dpB": "DP-3"},
				"runtime": {"connected": true, "activePort": "DP-2"}},
			{"physicalPortId": "gpu_p0", "slotOrder": 0, "pair": {"dpA": "DP-0", "dpB": "DP-1"},
				"runtime": {"connected": false}},
		]}}},
		"screenDestinations": {"version": 1, "destinations": [
			{"id": "dst_op_1", "label": "Operator GUI", "mode": "operator_gui", "width": 1920, "height": 1080, "fps": 50},
			{"id": "dst_pv_1", "label": "Main LED (DP-7)", "mode": "pgm_prv", "width": 1920, "height": 1080, "fps": 50},
			{"id": "host_1", "label": "Host ch 2", "mode": "host_channel", "casparChannel": 2},
		]},
		"audioOutputs": [],
	}


func _slot(built: Dictionary, title: String) -> Dictionary:
	for s in built.slots:
		if s.title == title:
			return s
	return {"items": []}


func _ids(items: Array) -> Array:
	var out := []
	for it in items:
		out.append(it.id)
	return out


func test_output_layer_values() -> void:
	t.eq(M.output_layer({}), 1, "no note key → PGM (1)")
	t.eq(M.output_layer({"note": 2}), 2, "int note 2 → PRV")
	t.eq(M.output_layer({"note": "{\"outputLayer\":2}"}), 2, "JSON note → 2")
	t.eq(M.output_layer({"note": "outputLayer=2"}), 2, "key=value note → 2")
	t.eq(M.output_layer({"note": "garbage"}), 1, "unparseable note → PGM (1)")
	t.eq(M.output_layer({"note": 0}), 1, "zero is clamped to PGM (1)")


func test_anchor_key_and_source_anchor() -> void:
	var plain := {"sourceId": "dst_in_dst_pv_1"}
	t.eq(M.source_anchor(plain), "dst_in_dst_pv_1#pgm", "destination source with no note leaves the PGM dot")
	t.eq(M.source_anchor({"sourceId": "dst_in_dst_pv_1", "note": "{\"outputLayer\":2}"}), "dst_in_dst_pv_1#prv",
		"destination source with outputLayer 2 leaves the PRV dot")
	t.eq(M.source_anchor({"sourceId": "gpu_p0"}), "gpu_p0", "non-destination source keeps its plain id")
	t.eq(M.anchor_key("a", ""), "a", "empty half gives the plain id")
	t.eq(M.anchor_key("a", "prv"), "a#prv", "prv half is suffixed")
	t.eq(M.anchor_key("a", "bogus"), "a", "unknown half is ignored")


func test_gpu_pair_label() -> void:
	t.eq(M.gpu_pair_label(["DP-0", "DP-1"]), "DP 0/1", "two DP pairs join with a slash")
	t.eq(M.gpu_pair_label(["DP-6", ""]), "DP 6", "empty second pair is dropped")
	t.eq(M.gpu_pair_label(["HDMI-0"]), "HDMI 0", "HDMI keeps its prefix")
	t.eq(M.gpu_pair_label([]), "", "no pairs gives an empty label")


func test_dest_sub() -> void:
	t.eq(M.dest_sub({"mode": "operator_gui", "width": 1920, "height": 1080, "fps": 50}),
		"OPG · 1920x1080@50", "operator GUI tag")
	t.eq(M.dest_sub({"width": 1920, "height": 1080, "fps": 50}), "PGM/PRV · 1920x1080@50", "default mode is pgm_prv")
	t.eq(M.dest_sub({"mode": "pgm_only", "width": 3840, "height": 2160, "fps": 59.94}),
		"PGM · 3840x2160@59.94", "fractional fps is kept")
	t.eq(M.dest_sub({"mode": "stream", "stream": {"type": "srt"}}), "STREAM · SRT", "stream shows its protocol")
	t.eq(M.dest_sub({"mode": "pgm_prv", "width": 10, "height": 1080, "fps": 50}),
		"PGM/PRV · 64x1080@50", "width below 64 clamps to 64")


func test_build_destinations() -> void:
	var built := M.build(_fixture())
	t.eq(built.destinations.size(), 2, "host_channel destination is skipped, two screen destinations remain")
	var op: Dictionary = built.destinations[0]
	t.eq(op.id, "dst_op_1", "operator GUI first, in payload order")
	t.eq(op.connector, "dst_in_dst_op_1", "connector is the dst_in_ id")
	t.eq(op.sub, "OPG · 1920x1080@50", "operator GUI sub line")
	t.eq(op.halves, [], "operator GUI has no PGM/PRV halves")
	t.eq(op.links, ["DP 2/3 · DP-2"], "operator GUI link to its GPU socket, no prefix")
	var pv: Dictionary = built.destinations[1]
	t.eq(pv.id, "dst_pv_1", "pgm_prv destination second")
	t.eq(pv.connector, "dst_in_dst_pv_1", "pgm_prv connector")
	t.eq(pv.sub, "PGM/PRV · 1920x1080@50", "pgm_prv sub line")
	t.eq(pv.halves, ["pgm", "prv"], "pgm_prv has two halves")
	t.eq(pv.links.size(), 1, "pgm_prv has one link")
	t.ok(str(pv.links[0]).begins_with("PRV: "), "pgm_prv link carries the PRV prefix, got '%s'" % str(pv.links[0]))
	t.eq(pv.links[0], "PRV: DP 0/1", "pgm_prv link text")


func test_build_slots_and_gpu_items() -> void:
	var built := M.build(_fixture())
	var titles := []
	for s in built.slots:
		titles.append(s.title)
	t.eq(titles, ["GPU", "DeckLink", "Stream", "Virtual cam", "Record", "Audio"], "rear-panel slot titles in order")
	var gpu: Array = _slot(built, "GPU").items
	t.eq(_ids(gpu), ["gpu_p0", "gpu_p1"], "GPU sockets sorted by slotOrder (gpu_p0 first)")
	t.eq(gpu[0].label, "DP 0/1", "unconnected socket label is its pair")
	t.eq(gpu[1].label, "DP 2/3 · DP-2", "connected socket label appends the active output")
	t.eq(gpu[0].connected, false, "gpu_p0 not connected")
	t.eq(gpu[1].connected, true, "gpu_p1 connected")


func test_build_decklink_order() -> void:
	var built := M.build(_fixture())
	t.eq(_ids(_slot(built, "DeckLink").items), ["dlsdi_1", "dlsdi_2"], "DeckLink ordered by index (dlsdi_1 first)")


func test_build_cables() -> void:
	var built := M.build(_fixture())
	t.eq(built.cables.size(), 2, "one cable per graph edge")
	var op_cable: Dictionary = built.cables[0]
	t.eq(op_cable.from, "dst_in_dst_op_1#pgm", "operator GUI cable leaves the PGM dot (no note)")
	t.eq(op_cable.to, "gpu_p1", "operator GUI cable lands on gpu_p1")
	t.eq(op_cable.label, "Operator GUI → DP 2/3 · DP-2", "operator GUI cable label")
	var pv_cable: Dictionary = built.cables[1]
	t.eq(pv_cable.from, "dst_in_dst_pv_1#prv", "PRV edge leaves the PRV dot")
	t.eq(pv_cable.to, "gpu_p0", "PRV cable lands on gpu_p0")
	t.eq(pv_cable.label, "Main LED (DP-7) → DP 0/1", "PRV cable label uses the destination label")


func test_gpu_ports_fallback_to_gpu_out() -> void:
	var payload := _fixture()
	payload.live = {}
	var built := M.build(payload)
	var items: Array = _slot(built, "GPU").items
	t.eq(_ids(items), ["gpu_p0", "gpu_p1"], "without a physical map the gpu_out connectors stand in")
	t.eq(items[0].label, "DP-0", "fallback label is the connector externalRef")
	t.eq(items[1].label, "DP-2", "fallback label is the externalRef for gpu_p1 too")
	t.eq(items[0].connected, false, "fallback sockets are never connected")


func test_build_empty_payload() -> void:
	var built := M.build({})
	t.eq(built.destinations, [], "empty payload → no destinations")
	t.eq(built.cables, [], "empty payload → no cables")
	t.eq(built.slots.size(), 6, "empty payload still draws the six rear-panel slots")
