extends RefCounted
## WO-605 slice 7c — pure port of client/lib/mapping-node-service.js (WO-41): the pixel_mapping node's video-mode
## helpers (custom "WxHpF" ids, the WO-437 standard-mode-outranks-stored-dims rule, the horizontal split proposal)
## and the graph edits the inspector makes. Every edit takes the graph just fetched from GET /api/device-view (the
## web's read-modify-write, WO-436), mutates it and returns {ok, error, …}; the caller POSTs {deviceGraph}. Ids use
## `now36` (Date.now().toString(36)) and `rand36` (Math.random().toString(36).slice(2, 8)) passed in, so the golden
## replay (test_devices_mapping.gd) can pin them.

const S := preload("res://features/devices/cable_seed.gd")
const R := preload("res://features/devices/cable_rules.gd")
const F := preload("res://features/devices/replication_format.gd")
const O := preload("res://features/devices/output_ports_model.gd")
const H := preload("res://features/devices/host_channels.gd")

## MAPPING_OUTPUT_VIDEO_MODES (new outputs take the first).
const MODES := ["1080p5000", "1080p5994", "1080p6000", "1080p2500", "1080p2997", "1080p3000", "2160p5000", "2160p2500",
	"720p5000", "576p2500", "PAL", "NTSC"]


## Math.max(1, parseInt(String(v), 10) || 1)
static func _pos_int(v: Variant) -> int:
	var n: Variant = S._int(v)
	return maxi(1, n if n else 1)


## Math.max(1, parseFloat(String(v)) || 50)
static func _pos_fps(v: Variant) -> float:
	var f: Variant = S._float(v)
	return maxf(1.0, f if f else 50.0)


static func base36(n: int) -> String:
	if n == 0:
		return "0"
	var out := ""
	while n > 0:
		out = "0123456789abcdefghijklmnopqrstuvwxyz"[n % 36] + out
		n /= 36
	return out


## parseCustomVideoMode: "3456x1152p50" → {width, height, fps, isCustom}, else {}.
static func parse_custom(mode: Variant) -> Dictionary:
	var m := RegEx.create_from_string("(?i)^(\\d{2,5})x(\\d{2,5})p([\\d.]+)$").search(R.s(mode))
	if not m:
		return {}
	return {"width": _pos_int(m.get_string(1)), "height": _pos_int(m.get_string(2)), "fps": _pos_fps(m.get_string(3)), "isCustom": true}


static func format_custom(width: Variant, height: Variant, fps: Variant) -> String:
	return "%dx%dp%s" % [_pos_int(width), _pos_int(height), O.js(_pos_fps(fps))]


## resolveMappingOutputResolution → {mode, width, height, fps, isCustom}.
static func resolve_output(output: Variant) -> Dictionary:
	var o := R.d(output)
	var mode := R.s(O.or_([o.get("mode"), "1080p5000"]))
	mode = mode if mode != "" else "1080p5000"
	var w := F._num(o, "width")
	var h := F._num(o, "height")
	var f := F._num(o, "fps")
	var custom := parse_custom(mode)
	if not custom.is_empty():
		return {"mode": mode, "width": w if is_finite(w) else custom.width, "height": h if is_finite(h) else custom.height,
			"fps": f if is_finite(f) else custom.fps, "isCustom": true}
	var standard := RegEx.create_from_string("(?i)^(720|1080|2160)[pi]\\d{4}$").search(mode) != null \
		or mode.to_lower() in ["pal", "ntsc"]
	if not standard and is_finite(w) and is_finite(h):
		return {"mode": mode, "width": w, "height": h, "fps": f if is_finite(f) else 50.0, "isCustom": not mode in MODES}
	var res := S.mode_resolution(mode)
	return {"mode": mode, "width": res.w, "height": res.h, "fps": res.fps, "isCustom": false}


## proposeMappingOutputLayout: split the input canvas into `n` side-by-side slices (the last takes the remainder).
static func propose_layout(in_w: Variant, in_h: Variant, fps: Variant, n: Variant) -> Array:
	var w_in := _pos_int(in_w)
	var h_in := _pos_int(in_h)
	var rate := _pos_fps(fps)
	var count := _pos_int(n)
	var base := w_in / count
	var out := []
	var x := 0
	for i in count:
		var w := w_in - x if i == count - 1 else base
		out.append({"label": "Output %d" % (i + 1), "width": w, "height": h_in, "fps": rate, "mode": format_custom(w, h_in, rate),
			"rect": {"x": x, "y": 0, "w": w, "h": h_in}})
		x += w
	return out


static func find_node(graph: Variant, id: String) -> Dictionary:
	for d in R.a(R.d(graph).get("devices")):
		if d is Dictionary and R.s(d.get("id")) == id and d.get("role") == "pixel_mapping":
			return d
	return {}


static func _outputs(node: Dictionary) -> Array:
	return R.a(R.d(node.get("settings")).get("outputs"))


static func _out_ids(graph: Dictionary, id: String) -> Array:
	return R.a(graph.get("connectors")).filter(func(c: Variant) -> bool:
		return c is Dictionary and R.s(c.get("deviceId")) == id and c.get("kind") == "pixel_map_out").map(
		func(c: Dictionary) -> String: return R.s(c.get("id")))


## syncPixelMapOutputConnectors: pixel_map_out connectors rebuilt from settings.outputs (array order = index).
static func sync_out_connectors(graph: Dictionary, id: String) -> void:
	var node := find_node(graph, id)
	if node.is_empty():
		return
	var outputs := _outputs(node)
	var st := R.d(node.get("settings")).duplicate()
	st.outputs = outputs
	st.numOutputs = outputs.size()
	node.settings = st
	var kept := R.a(graph.get("connectors")).filter(func(c: Variant) -> bool:
		return not (R.s(R.d(c).get("deviceId")) == id and R.d(c).get("kind") == "pixel_map_out"))
	for i in outputs.size():
		var o := R.d(outputs[i])
		kept.append({"id": "%s_%s" % [id, R.s(o.get("id"))], "deviceId": id, "kind": "pixel_map_out", "index": i,
			"label": R.s(O.or_([o.get("label"), "Output %d" % (i + 1)]))})
	graph.connectors = kept


static func _prune_edges(graph: Dictionary, id: String, prev: Array) -> void:
	var next := _out_ids(graph, id)
	graph.edges = R.a(graph.get("edges")).filter(func(e: Variant) -> bool:
		for k in ["sourceId", "sinkId"]:
			var v := R.s(R.d(e).get(k))
			if v in prev and not v in next:
				return false
		return true)


static func rename(graph: Dictionary, id: String, label: String) -> Dictionary:
	var node := find_node(graph, id)
	if node.is_empty():
		return {"ok": false, "error": "Node not found"}
	node.label = label.strip_edges()
	return {"ok": true}


## duplicateMappingNode → {ok, newId, graph} (a new graph: node + its in / out connectors appended, no cables).
## `rand36` is drawn once per slice, like the web's Math.random() per mapping (one tag for all collided their ids).
static func duplicate_node(graph: Dictionary, id: String, now36: String, rand36: Callable) -> Dictionary:
	var src := find_node(graph, id)
	if src.is_empty():
		return {"ok": false, "error": "Node not found"}
	var devices := R.a(graph.get("devices"))
	var seq := 1
	var new_id := "mapping_%s_%d" % [now36, seq]
	while devices.any(func(d: Variant) -> bool: return R.s(R.d(d).get("id")) == new_id):
		seq += 1
		new_id = "mapping_%s_%d" % [now36, seq]
	var defs := []
	for i in _outputs(src).size():
		var o := R.d(_outputs(src)[i])
		defs.append({"id": "out_%d" % (i + 1), "mode": R.s(O.or_([o.get("mode"), MODES[0]])), "label": R.s(O.or_([o.get("label"), "Output %d" % (i + 1)]))})
	if defs.is_empty():
		defs = [{"id": "out_1", "mode": MODES[0], "label": "Output 1"}]
	var node: Dictionary = src.duplicate(true)
	node.id = new_id
	node.label = "%s Copy" % R.s(O.or_([src.get("label"), "Pixel Mapping"]))
	var st := R.d(src.get("settings")).duplicate(true)
	st.numOutputs = defs.size()
	st.outputs = defs
	st.mappings = R.a(R.d(src.get("settings")).get("mappings")).map(func(m: Variant) -> Variant:
		var c: Variant = m.duplicate(true) if m is Dictionary else {}
		c.id = "map_%s_%s" % [now36, rand36.call()]
		return c)
	if st.has("slices"):  # WO-869: the copy's outputs are renumbered out_1…; its slices follow by output position
		var by_pos := {}
		for i in _outputs(src).size():
			by_pos[R.s(R.d(_outputs(src)[i]).get("id"))] = defs[i].id
		st.slices = R.a(st.get("slices")).map(func(sl: Variant) -> Variant:
			var c: Dictionary = R.d(sl).duplicate(true)
			c.outputId = by_pos.get(R.s(c.get("outputId")), defs[0].id)
			return c)
	node.settings = st
	var conns := [{"id": new_id + "_in", "deviceId": new_id, "kind": "pixel_map_in", "label": "Input Feed"}]
	for i in defs.size():
		conns.append({"id": "%s_%s" % [new_id, defs[i].id], "deviceId": new_id, "kind": "pixel_map_out", "index": i, "label": defs[i].label})
	var next := graph.duplicate()
	next.devices = devices + [node]
	next.connectors = R.a(graph.get("connectors")) + conns
	next.edges = R.a(graph.get("edges"))
	return {"ok": true, "newId": new_id, "graph": next}


static func add_output(graph: Dictionary, id: String) -> Dictionary:
	var node := find_node(graph, id)
	if node.is_empty():
		return {"ok": false, "error": "Node not found"}
	var outputs := _outputs(node).duplicate()
	var n := outputs.size() + 1
	while outputs.any(func(o: Variant) -> bool: return str(R.d(o).get("id", "")) == "out_%d" % n):
		n += 1  # WO-843: after a middle output was removed size + 1 is taken (out_1, out_3 → a second out_3)
	outputs.append({"id": "out_%d" % n, "mode": MODES[0], "label": "Output %d" % n})
	var st := R.d(node.get("settings")).duplicate()
	st.outputs = outputs
	st.numOutputs = outputs.size()
	node.settings = st
	sync_out_connectors(graph, id)
	return {"ok": true}


## removeMappingOutput: slices on the removed output move to the first remaining one; its cables are dropped.
static func remove_output(graph: Dictionary, id: String, out_id: String) -> Dictionary:
	var node := find_node(graph, id)
	if node.is_empty():
		return {"ok": false, "error": "Node not found"}
	var outputs := _outputs(node)
	if outputs.size() <= 1:
		return {"ok": false, "error": "At least one output required"}
	var prev := _out_ids(graph, id)
	var next := outputs.filter(func(o: Variant) -> bool: return R.s(R.d(o).get("id")) != out_id)
	var first := R.s(R.d(next[0]).get("id")) if not next.is_empty() and R.s(R.d(next[0]).get("id")) != "" else "out_1"
	var st := R.d(node.get("settings")).duplicate()
	st.outputs = next
	st.numOutputs = next.size()
	var moved := func(m: Variant) -> Variant:
		if R.s(R.d(m).get("outputId")) != out_id:
			return m
		var c: Dictionary = m.duplicate()
		c.outputId = first
		return c
	st.mappings = R.a(st.get("mappings")).map(moved)
	if st.has("slices"):  # WO-869: the node's slices follow the same rule
		st.slices = R.a(st.get("slices")).map(moved)
	node.settings = st
	sync_out_connectors(graph, id)
	_prune_edges(graph, id, prev)
	return {"ok": true}


## updateMappingOutputFields: `patch` keys label / mode / width / height / fps (null = untouched).
static func update_fields(graph: Dictionary, id: String, out_id: String, patch: Dictionary) -> Dictionary:
	var node := find_node(graph, id)
	if node.is_empty():
		return {"ok": false, "error": "Node not found"}
	var outputs := _outputs(node)
	var cur := {}
	for o in outputs:
		if R.s(R.d(o).get("id")) == out_id:
			cur = o
	if cur.is_empty():
		return {"ok": false, "error": "Output not found"}
	for k in ["label", "mode"]:
		if patch.get(k) != null:
			var v := R.s(patch[k])
			if v != "":
				cur[k] = v
	for k in ["width", "height"]:
		if patch.get(k) != null:
			cur[k] = _pos_int(patch[k])
	if patch.get("fps") != null:
		cur.fps = _pos_fps(patch.fps)
	sync_out_connectors(graph, id)
	return {"ok": true}


## proposeMappingOutputsFromInput: each output gets its slice's custom mode and a fresh video_slice mapping.
static func propose(graph: Dictionary, id: String, input: Dictionary) -> Dictionary:
	var node := find_node(graph, id)
	if node.is_empty():
		return {"ok": false, "error": "Node not found"}
	var outputs := _outputs(node)
	if outputs.is_empty():
		return {"ok": false, "error": "No outputs on node"}
	var proposed := propose_layout(input.get("width"), input.get("height"), H.coalesce([input.get("fps"), 50]), outputs.size())
	var mappings := []
	for i in outputs.size():
		var o: Dictionary = outputs[i]
		var p: Dictionary = proposed[i]
		for k in ["mode", "width", "height", "fps"]:
			o[k] = p[k]
		if not H.truthy(o.get("label")):
			o.label = p.label
		mappings.append({"id": "map_" + R.s(o.get("id")), "type": "video_slice", "label": O.or_([o.get("label"), p.label]),
			"outputId": o.get("id"), "rotation": 0, "rect": p.rect.duplicate()})
	var st := R.d(node.get("settings")).duplicate()
	st.outputs = outputs
	st.mappings = mappings
	st.numOutputs = outputs.size()
	node.settings = st
	sync_out_connectors(graph, id)
	return {"ok": true, "proposed": proposed}


## The inspector's saveRect: `out` is the output as the page rendered it (a missing slice is created from it).
static func save_rect(graph: Dictionary, id: String, out: Dictionary, x: Variant, y: Variant, w: Variant, h: Variant, now36: String) -> bool:
	var node := find_node(graph, id)
	if node.is_empty():
		return false
	var st := R.d(node.get("settings"))
	var ms := R.a(st.get("mappings"))
	var slice := {}
	for m in ms:
		if R.s(R.d(m).get("outputId")) == R.s(out.get("id")):
			slice = m
			break
	if slice.is_empty():
		var res := resolve_output(out)
		slice = {"id": "map_" + now36, "type": "video_slice", "rect": {"x": 0, "y": 0, "w": res.width, "h": res.height},
			"rotation": 0, "outputId": out.get("id")}
		if out.has("label"):
			slice.label = out.label
		ms.append(slice)
	if not slice.get("rect") is Dictionary:
		slice.rect = {}
	var nx: Variant = S._int(x)
	var ny: Variant = S._int(y)
	slice.rect.x = nx if nx else 0
	slice.rect.y = ny if ny else 0
	slice.rect.w = _pos_int(w)
	slice.rect.h = _pos_int(h)
	st.mappings = ms
	node.settings = st
	return true
