extends RefCounted
## WO-605 slice 7c — the mapping node page's and column's request sequences (web device-view-inspector-mapping.js +
## mapping-node-service.js + the column's onAddMappingNode / mappingPersist in device-view-bands-render.js), over an
## injected io shared by the page controller and the golden replay:
##   io.get_json(path) / io.post_json(path, body) → {ok, data, error}   io.confirm(text) → bool   io.alert(text)
##   io.dirty()  io.reload()  io.status(text, ok)  io.fail(text)
## Each node edit re-reads the graph (GET /api/device-view, cache-busted — WO-436), edits it with mapping_graph.gd and
## POSTs {deviceGraph}. `fail` = an error the web drops silently (failed label / mode / rect / add / duplicate / delete
## saves); the controller shows it on the status line.

const G := preload("res://features/devices/mapping_graph.gd")
const M := preload("res://features/devices/mapping_page_model.gd")
const R := preload("res://features/devices/cable_rules.gd")
const H := preload("res://features/devices/host_channels.gd")

var payload: Dictionary  # the device view the page was rendered from
var node_id: String
var io: Variant
var clock: Callable = func() -> float: return Time.get_unix_time_from_system() * 1000.0
var rand36: Callable = func() -> String: return G.base36(randi() % 2176782336).lpad(6, "0")


func _init(payload_: Dictionary, node_id_: String, io_: Variant) -> void:
	payload = payload_
	node_id = node_id_
	io = io_


func _now36() -> String:
	return G.base36(int(clock.call()))


func _output(i: int) -> Dictionary:
	var outs := G._outputs(G.find_node(payload.get("graph"), node_id))
	return R.d(outs[i]) if i >= 0 and i < outs.size() else {}


## fetchDeviceView → the graph to edit, or {} (with `err` set).
func _fetch(err: Dictionary) -> Dictionary:
	var r: Dictionary = await io.get_json("/api/device-view?_ts=%d" % int(clock.call()))
	if not r.ok:
		err.error = str(r.error)
		return {}
	var g: Variant = R.d(r.data).get("graph")
	if not g is Dictionary:
		err.error = "No graph"
		return {}
	return g


func _save(graph: Dictionary) -> Dictionary:
	var r: Dictionary = await io.post_json("/api/device-view", {"deviceGraph": graph})
	return {"ok": r.ok, "error": str(r.get("error", ""))}


## Fetch → `edit` (graph → {ok, error, …}) → save; the web's service call shape.
func _edit(edit: Callable) -> Dictionary:
	var err := {}
	var graph := await _fetch(err)
	if err.has("error"):
		return {"ok": false, "error": err.error}
	var r: Dictionary = edit.call(graph)
	if not r.ok:
		return r
	var s := await _save(r.get("graph", graph))
	if not s.ok:
		return s
	return r


func rename(text: String) -> void:
	var label := text.strip_edges()
	if label == "":
		io.status("Empty label", false)
		return
	var r := await _edit(func(g: Dictionary) -> Dictionary: return G.rename(g, node_id, label))
	if r.ok:
		io.reload()
	else:
		io.status(r.error, false)


func propose() -> void:
	var input := M.input_resolution(payload, node_id)
	if input.is_empty():
		io.status(M.NO_INPUT, false)
		return
	var r := await _edit(func(g: Dictionary) -> Dictionary: return G.propose(g, node_id, input))
	if not r.ok:
		io.status(r.error if r.error != "" else "Could not propose outputs", false)
		return
	io.dirty()
	io.status(M.proposed_text(r.get("proposed", [])), true)
	io.reload()


func _saved(r: Dictionary) -> void:
	if r.ok:
		io.dirty()
		io.reload()
	else:
		io.fail(r.error)


func remove_output(i: int) -> void:
	if not await io.confirm(M.REMOVE_CONFIRM):
		return
	var out_id := R.s(_output(i).get("id"))
	var r := await _edit(func(g: Dictionary) -> Dictionary: return G.remove_output(g, node_id, out_id))
	if r.ok:
		io.dirty()
		io.reload()
	else:
		io.alert("Failed to remove output: " + (r.error if r.error != "" else "Unknown error"))


func set_label(i: int, text: String) -> void:
	var out_id := R.s(_output(i).get("id"))
	_saved(await _edit(func(g: Dictionary) -> Dictionary: return G.update_fields(g, node_id, out_id, {"label": text})))


## The Mode select: a standard mode mirrors its size into `f` and saves; Custom only unlocks the fields.
func on_mode(i: int, mode: String, f: Dictionary) -> void:
	f.mode = mode
	M.mirror_mode(f)
	if mode != "custom":
		await save_mode(i, f)


## saveCustom (WO-437): a standard mode saves its own size, Custom the three fields.
func save_mode(i: int, f: Dictionary) -> void:
	var out_id := R.s(_output(i).get("id"))
	var patch := {}
	if f.mode == "custom":
		var w := G._pos_int(f.cw)
		var h := G._pos_int(f.ch)
		var fps := G._pos_fps(f.cf)
		patch = {"mode": G.format_custom(w, h, fps), "width": w, "height": h, "fps": fps}
	else:
		var std := G.S.mode_resolution(f.mode)
		patch = {"mode": f.mode, "width": std.w, "height": std.h, "fps": std.fps}
	_saved(await _edit(func(g: Dictionary) -> Dictionary: return G.update_fields(g, node_id, out_id, patch)))


func save_rect(i: int, f: Dictionary) -> void:
	var out := _output(i)
	var now36 := _now36()
	var err := {}
	var graph := await _fetch(err)
	if err.has("error"):
		io.fail(err.error)
		return
	if not G.save_rect(graph, node_id, out, f.x, f.y, f.w, f.h, now36):
		return
	_saved(await _save(graph))


func add_output() -> void:
	_saved(await _edit(func(g: Dictionary) -> Dictionary: return G.add_output(g, node_id)))


func duplicate() -> void:
	var now36 := _now36()
	var r := await _edit(func(g: Dictionary) -> Dictionary: return G.duplicate_node(g, node_id, now36, rand36))
	if r.ok:
		io.reload()  # the web marks no restart-dirty here
	else:
		io.fail(r.error)


func delete_node() -> void:
	var node := G.find_node(payload.get("graph"), node_id)
	if not await io.confirm(M.delete_confirm(node)):
		return
	var r: Dictionary = await io.post_json("/api/device-view", {"removeMappingNode": {"id": node_id}})
	var err := str(r.error) if not r.ok else (str(r.data.error) if r.data is Dictionary and H.truthy(r.data.get("error")) else "")
	if err != "":
		io.fail(err)
		return
	io.dirty()
	io.reload()


# ---------------------------------------------------------------- the column (no page needed)

## The column's "+": the server builds the node (2 outputs, 1080p5000).
static func add_node(io_: Variant) -> void:
	var r: Dictionary = await io_.post_json("/api/device-view", {"addMappingNode": true})
	if not r.ok:
		io_.status(str(r.error), false)
		return
	io_.dirty()
	io_.status(M.ADDED, true)
	io_.reload()


## A card's "+": one more output on that node (mappingPersist around addMappingOutput).
static func add_card_output(io_: Variant, id: String, now: float) -> void:
	var f = load("res://features/devices/mapping_flow.gd").new({}, id, io_)
	f.clock = func() -> float: return now
	var r: Dictionary = await f._edit(func(g: Dictionary) -> Dictionary: return G.add_output(g, id))
	if not r.ok:
		io_.status(r.error if r.error != "" else "Mapping save failed", false)
		return
	io_.dirty()
	io_.status(M.UPDATED, true)
	io_.reload()
