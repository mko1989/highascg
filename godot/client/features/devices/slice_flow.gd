extends RefCounted
## WO-869 — one mapping node's slice list being edited, shared by the Inspector section (slice_inspector.gd) and the
## two centre canvases (slice_canvas_src.gd / slice_canvas_dst.gd). Every edit lands here; `changed(kind)` tells the
## views what to redraw ("list": rows / selection / fields, "geometry": a value moved, "select"). Saves go to
## POST /api/device-view {updateMappingSlices: {nodeId, slices}}: the server persists, then either applies the set
## live (`APPLY … SLICES SET`, slice-window outputs) or answers casparRestartNeeded (backend / placement changed) →
## io.dirty() lights the toolbar's Apply. Saves are coalesced: one in flight, the latest state goes next.
## io: post_json(path, body) → {ok, data, error}; status(text, ok); dirty().

signal changed(kind: String)

const SM := preload("res://features/devices/slice_model.gd")
const SP := preload("res://features/devices/slice_page_model.gd")
const G := preload("res://features/devices/mapping_graph.gd")
const M := preload("res://features/devices/mapping_page_model.gd")
const R := preload("res://features/devices/cable_rules.gd")

var io: Variant
var node_id := ""
var label := ""
var slices: Array = []
var outputs: Array = []  # [{id, label, w, h}]
var plans: Array = []  # the node's mappingSlicePlans entry, as a one-element list (SP.plan_row reads lists)
var input := Vector2(1920, 1080)  # the feed raster the src rects live in
var channel := 0  # PGM channel feeding the node (0 = not cabled / unknown)
var screen := 0  # program screen feeding the node (1-based; 0 = not cabled): the canvases show surface "pgm<screen>"
var sel := -1
var saves := 0  # completed saves (tests / e2e wait on it)
var last_result := {}
var _saving := false
var _again := false


func _init(io_: Variant) -> void:
	io = io_


## (Re)load from a device-view payload; keeps the selection while the same node stays open.
func load_payload(payload: Dictionary, id: String, channel_map: Variant = null) -> void:
	var keep := id == node_id
	node_id = id
	var node := G.find_node(payload.get("graph"), id)
	label = str(node.get("label", id))
	outputs = []
	for o in G._outputs(node):
		var res := G.resolve_output(o)
		outputs.append({"id": R.s(R.d(o).get("id")), "label": R.s(R.d(o).get("label")) if R.s(R.d(o).get("label")) != "" else R.s(R.d(o).get("id")),
			"w": int(res.width), "h": int(res.height)})
	var res_in := M.input_resolution(payload, id)
	if not res_in.is_empty():
		input = Vector2(maxf(1.0, float(res_in.width)), maxf(1.0, float(res_in.height)))
	var feed := SP.feed_screen(payload, id, channel_map)
	screen = int(feed.get("screen", 0))
	channel = int(feed.get("channel", 0))
	plans = R.a(payload.get("mappingSlicePlans")).filter(func(p: Variant) -> bool: return R.s(R.d(p).get("nodeId")) == id)
	if not _saving:  # an answer in flight carries newer slices than this payload
		slices = SM.normalize_slices(R.d(node.get("settings")).get("slices", []), output_ids(), {"w": input.x, "h": input.y})
	if not keep or sel >= slices.size():
		sel = -1
	changed.emit("list")


## The VideoSurfaces role of the node's input picture ("" = none).
func video_role() -> String:
	return "pgm%d" % screen if screen > 0 else ""


func output_ids() -> Array:
	return outputs.map(func(o: Dictionary) -> String: return str(o.id))


func output(id: String) -> Dictionary:
	for o in outputs:
		if o.id == id:
			return o
	return outputs[0] if not outputs.is_empty() else {"id": "", "label": "", "w": 1920, "h": 1080}


func plan_row(out_id: String) -> Dictionary:
	return SP.plan_row(plans, node_id, out_id)


## [[output label, backend text]] for the Inspector's "drawn as" lines.
func drawn() -> Array:
	return outputs.map(func(o: Dictionary) -> Array: return [o.label, SP.backend_text(plan_row(o.id))])


func selected() -> Dictionary:
	return slices[sel] if sel >= 0 and sel < slices.size() else {}


func select(i: int) -> void:
	if i == sel:
		return
	sel = i if i >= 0 and i < slices.size() else -1
	changed.emit("select")


## One field of slice `i` (path as slice_model.gd get_at). `commit` false = a drag in progress (no save yet).
func set_field(i: int, path: String, value: Variant, commit := true) -> void:
	if i < 0 or i >= slices.size():
		return
	SM.set_at(slices[i], path, value)
	if path == "dst.rotation":
		slices[i].dst.rotation = SM.norm_rotation(float(value))
	changed.emit("list" if path in ["name", "outputId", "enabled"] else "geometry")
	if commit:
		save()


## A whole-slice replacement from a canvas gesture (src / dst moved together).
func put(i: int, s: Dictionary, commit := true) -> void:
	if i < 0 or i >= slices.size():
		return
	slices[i] = s
	changed.emit("geometry")
	if commit:
		save()


func add(out_id := "", src := {}) -> void:
	if slices.size() >= SM.MAX_SLICES:
		io.status("At most %d slices per mapping node" % SM.MAX_SLICES, false)
		return
	var oid := out_id if out_id != "" else (str(outputs[0].id) if not outputs.is_empty() else "out_1")
	var o := output(oid)
	var r: Dictionary = src if not src.is_empty() else {"x": 0, "y": 0, "w": mini(int(o.w), int(input.x)), "h": mini(int(o.h), int(input.y))}
	slices.append(SM.new_slice(slices, oid, r))
	sel = slices.size() - 1
	changed.emit("list")
	save()


func duplicate_sel() -> void:
	if sel < 0 or slices.size() >= SM.MAX_SLICES:
		return
	slices.append(SM.duplicated(slices, sel))
	sel = slices.size() - 1
	changed.emit("list")
	save()


func delete_sel() -> void:
	if sel < 0:
		return
	slices.remove_at(sel)
	sel = mini(sel, slices.size() - 1)
	changed.emit("list")
	save()


func move_z(dir: int) -> void:
	if sel >= 0 and SM.move_z(slices, sel, dir):
		changed.emit("geometry")
		save()


func save() -> void:
	if _saving:
		_again = true
		return
	_saving = true
	while true:
		_again = false
		var r: Dictionary = await io.post_json("/api/device-view", {"updateMappingSlices": {"nodeId": node_id, "slices": slices.duplicate(true)}})
		var data := R.d(r.get("data"))
		if not r.ok or R.s(data.get("error")) != "":
			io.status("Slices not saved: %s" % (str(r.error) if not r.ok else R.s(data.error)), false)
		else:
			last_result = data
			if data.get("plan") is Dictionary:
				plans = [data.plan]
			if SM.is_true(data.get("casparRestartNeeded")):
				io.dirty()
				io.status("Slices saved — Apply to restart Caspar with the new outputs", true)
			elif SM.is_true(R.d(data.get("live")).get("applied")):
				io.status("Slices applied live", true)
			elif R.s(R.d(data.get("live")).get("error")) != "":
				io.status("Slices saved; Caspar did not take the live edit: %s" % R.s(data.live.error), false)
			else:
				io.status("Slices saved", true)
			changed.emit("plan")
		if not _again:
			break
	_saving = false
	saves += 1
