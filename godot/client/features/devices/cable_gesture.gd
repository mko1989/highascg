extends Node
## WO-605 slice 2c — the cable gesture (web device-view-cable.js, device-view-cable-outputs.js and the key/click
## handlers of device-view-events.js): arm → complete, select → re-grab → commit, remove one / all, undo, and the
## Caspar-restart dirty flag that Apply clears. What to write comes from cable_rules.gd / cable_seed.gd (golden-tested
## against the web); this node only sequences the POSTs in the web's order and asks the tab to reload after every
## mutation. Nothing is persisted while a gesture is open — cancelling it is a pure redraw.

signal changed  # armed / selected / dirty / busy moved → the tab repaints tints, ghost, toolbar
signal status(text: String, ok: bool)
signal reload_requested

const R := preload("res://features/devices/cable_rules.gd")
const Seed := preload("res://features/devices/cable_seed.gd")
const PREWARM_S := 2.5  # under the server's 3 s xrandr cache TTL (web device-view-snapshot-prewarm.js)
const UNDO_MAX := 50
const CANCELLED := "Cable mode cancelled"
const REGRAB_CANCELLED := "Cable re-grab cancelled — connection left as it was."

var payload := {}  # last GET /api/device-view
var source_id := ""  # the armed connector (a re-grab arms its anchored far end)
var source_half := ""  # "prv" when armed on a pair's PRV dot
var regrab := {}  # cable_rules.pick_regrab() while an end is held
var selected_edge := ""
var restart_dirty := false
var busy := false
var applying := false

var _undo: Array = []
var _prewarm: Timer


func _ready() -> void:
	_prewarm = Timer.new()
	_prewarm.wait_time = PREWARM_S
	_prewarm.timeout.connect(_warm)
	add_child(_prewarm)


func armed() -> bool:
	return source_id != ""


## The dot the ghost cable leaves: a re-grab hanging off a destination keeps its edge's half (web cableAnchorHalf).
func ghost_anchor() -> String:
	if not armed():
		return ""
	var half := source_half
	if not regrab.is_empty():
		half = ""
		if regrab.get("end") == "sink":
			var e := edge(R.s(regrab.get("edgeId")))
			if not e.is_empty() and R.s(e.sourceId).begins_with("dst_in_"):
				half = "prv" if _layer(e) >= 2 else "pgm"
	return source_id + ("#" + half if half != "" else "")


## Would a cable from the armed connector to `id` be accepted by role/direction (web valid/invalid tint)?
func target_ok(id: String) -> bool:
	return armed() and id != source_id and not R.order_edge(payload, source_id, id).is_empty()


func select_edge(id: String) -> void:
	if armed() or edge(id).is_empty():
		return
	selected_edge = id
	changed.emit()


## A connector dot was clicked; `key` is its anchor key (`id` or `id#pgm` / `id#prv`).
func click(key: String) -> void:
	if busy:
		return
	var id := key.get_slice("#", 0)
	var half := key.get_slice("#", 1) if key.contains("#") else ""
	if armed() and id != source_id:
		await _complete(id)
		return
	if armed() and not regrab.is_empty():
		return
	if not armed() and _begin_regrab(id):
		return
	if not R.can_start(payload, id):
		status.emit("Cable can start only from destination output or output connector.", false)
		return
	selected_edge = ""
	source_id = id
	source_half = "prv" if half == "prv" else ""
	_start_prewarm()
	changed.emit()
	status.emit("Cable armed: click another connector dot to connect", true)


## Empty space or Esc: leave the gesture; nothing was written, so a held end simply reappears.
func cancel() -> bool:
	if not armed():
		return false
	var was_regrab := not regrab.is_empty()
	_clear()
	status.emit(REGRAB_CANCELLED if was_regrab else CANCELLED, true)
	return true


## WO-732 P3b: the Devices tab switched server — an open gesture, the selection, undo and the restart flag belong to
## the server they were made on.
func forget() -> void:
	selected_edge = ""
	_undo.clear()
	restart_dirty = false
	_clear()


func _clear() -> void:
	source_id = ""
	source_half = ""
	regrab = {}
	_prewarm.stop()
	changed.emit()


func _start_prewarm() -> void:
	_warm()
	_prewarm.start()


func _warm() -> void:
	DevicesTarget.api.get_json("/api/device-view/snapshot")  # fire-and-forget: only warms the server's live-hardware cache


## WO-278 (B): with a cable selected, clicking one of its ends lifts that end; the far end becomes the anchor.
func _begin_regrab(id: String) -> bool:
	if selected_edge == "":
		return false
	var hit := R.canonical_id(payload, id)
	var grab := R.pick_regrab(R.a(R.d(payload.get("graph")).get("edges")), hit if hit != "" else id, selected_edge)
	if grab.is_empty():
		return false
	regrab = grab
	source_id = R.s(grab.anchorId)
	source_half = ""
	_start_prewarm()
	changed.emit()
	status.emit("Cable end grabbed: click another connector to move it, or click empty space to restore.", true)
	return true


## tryAddCable: validate, then preflight → addEdge (one recovery retry) → PRV note → GPU settings/connector seed.
func _complete(target: String) -> void:
	if not regrab.is_empty():
		await _commit_regrab(target)
		return
	var o := R.order_edge(payload, source_id, target)
	if o.is_empty():
		_clear()
		status.emit("These connectors cannot be cabled together (wrong roles or direction).", false)
		return
	var src := _canon(o.sourceId)
	var sink := _canon(o.sinkId)
	var conflict := R.sink_conflict(payload, sink)
	if not conflict.is_empty():
		var note := " (DP A/B names on the same physical socket share one cable slot)" \
			if R.gpu_port_cable_id(target) == sink and target.contains("__") else ""
		_clear()
		status.emit("%s already has a cable from %s. Remove that cable first.%s" % [R.friendly_label(payload, sink),
			R.friendly_label(payload, R.s(conflict.sourceId)), note], false)
		return
	var half := source_half
	_set_busy(true)
	_push_undo()
	var err := await _preflight(src, sink)
	var r := {"ok": false, "error": ""}
	if err == "":
		r = await _post({"addEdge": {"sourceId": src, "sinkId": sink}})
	if err == "" and not r.ok and R.is_unknown_connector_error(r.error):
		err = await _recover(src, sink)
		if err == "":
			r = await _post({"addEdge": {"sourceId": src, "sinkId": sink}})
	if err == "" and not r.ok:
		err = R.describe_rejection(r.error)  # the web's api client throws on 4xx, so no "(src → sink)" suffix
	if err != "":
		_set_busy(false)
		_clear()
		status.emit(err, false)
		reload_requested.emit()
		return
	_take_graph(r.data)
	if half == "prv" and src.begins_with("dst_in_"):
		await _set_output_layer(_edge_between(src, sink), 2)
	var sink_conn := R.connector_by_id(payload, sink)
	if R.s(sink_conn.get("kind")) == "gpu_out" and DevicesTarget.settings.is_loaded:
		var w := Seed.gpu_sink_writes(payload, R.d(DevicesTarget.settings.settings.get("casparServer")), src, sink, half)
		if not w.settings.is_empty():
			await _post_settings(w.settings)
		if not w.connector.is_empty():
			await _post({"updateConnector": {"id": sink, "patch": w.connector}})
	_set_busy(false)
	_clear()
	if R.sink_needs_restart(sink_conn, R.dedicated_streaming(DevicesTarget.settings.settings)):
		set_dirty(true)
	reload_requested.emit()


## ensureCableConnectorsInSavedGraph: write minimal rows for cable ends the saved graph lacks.
func _preflight(src: String, sink: String) -> String:
	var p := Seed.preflight(payload, DevicesTarget.settings.settings, [src, sink])
	if p.added.is_empty():
		return ""
	var r := await _post({"deviceGraph": p.graph})
	if not r.ok:
		return R.describe_rejection(r.error)
	_take_graph(r.data if r.data is Dictionary and r.data.has("graph") else {"graph": p.graph})
	return ""


## recoverDeviceGraphForCable: persist the GPU bracket topology, re-read, preflight again.
func _recover(src: String, sink: String) -> String:
	var topo := R.topology(payload, DevicesTarget.settings.settings)
	if not topo.is_empty():
		await DevicesTarget.api.post_json("/api/settings", {"gpuPhysicalTopology": topo})
	var fresh := await DevicesTarget.api.get_json("/api/device-view")
	if fresh.ok and fresh.data is Dictionary:
		payload = fresh.data
		payload.gpuPhysicalTopology = topo
	return await _preflight(src, sink)


## commitCableRegrab: plan first (a restore writes nothing), then remove-then-add with rollback, carrying a PRV note.
func _commit_regrab(target: String) -> void:
	var grab := regrab
	var plan := R.plan_regrab(payload, grab, target)
	if plan.action != "retarget":
		_clear()
		if plan.action == "restore":
			status.emit(R.describe_restore(plan), plan.reason == "unchanged")
		return
	var rollback := R.regrab_rollback(grab)
	var held := edge(R.s(plan.removeEdgeId))
	var layer := _layer(held) if not held.is_empty() else 1
	_clear()
	_set_busy(true)
	_push_undo()
	var err := ""
	var r := await _post({"removeEdge": {"id": plan.removeEdgeId}})
	if not r.ok:
		err = R.describe_rejection(r.error)
	else:
		_take_graph(r.data)
		r = await _post({"addEdge": {"sourceId": plan.sourceId, "sinkId": plan.sinkId}})
		if not r.ok:
			err = R.describe_rejection(r.error)
			if not rollback.is_empty():
				var back := await _post({"addEdge": {"sourceId": rollback.sourceId, "sinkId": rollback.sinkId}})
				if back.ok:
					_take_graph(back.data)
					await _restore_layer(layer, R.s(rollback.sourceId), R.s(rollback.sinkId))
	if err == "":
		_take_graph(r.data)
		await _restore_layer(layer, R.s(plan.sourceId), R.s(plan.sinkId))
		if selected_edge == R.s(plan.removeEdgeId):
			selected_edge = ""
		if R.sink_needs_restart(R.connector_by_id(payload, R.s(plan.sinkId)), R.dedicated_streaming(DevicesTarget.settings.settings)):
			set_dirty(true)
		status.emit("Cable moved to " + R.friendly_label(payload, R.s(plan.sinkId)), true)
	else:
		status.emit("Cable move failed — original connection restored: " + err, false)
	_set_busy(false)
	reload_requested.emit()


func _restore_layer(layer: int, src: String, sink: String) -> void:
	if layer >= 2 and src.begins_with("dst_in_"):
		await _set_output_layer(_edge_between(src, sink), layer)


## updateDestinationOutputLayer: the edge's note → {"outputLayer": N}, saved as the whole graph.
func _set_output_layer(edge_id: String, layer: int) -> void:
	var g := Seed.with_output_layer(R.d(payload.get("graph")), edge_id, layer)
	if g.is_empty():
		return
	var r := await _post({"deviceGraph": g})
	if r.ok:
		_take_graph(r.data if r.data is Dictionary and r.data.has("graph") else {"graph": g})
		set_dirty(true)
	else:
		status.emit("Output mapping update failed: " + R.s(r.error), false)


## Matrix view crosspoint: the whole new graph through settings (the web's saveSettingsPatch({deviceGraph})), then
## restart-dirty + reload. The web only logs a failure to the console; here it shows in the status line.
func route(g: Dictionary) -> void:
	if busy:
		return
	_push_undo()
	_set_busy(true)
	var r := await _post_settings({"deviceGraph": g})
	_set_busy(false)
	if not r.ok:
		status.emit("Matrix route failed: " + R.s(r.error), false)
		return
	set_dirty(true)
	reload_requested.emit()


func remove_edge(id: String) -> void:
	if busy or id == "":
		return
	_set_busy(true)
	_push_undo()
	var r := await _post({"removeEdge": {"id": id}})
	_set_busy(false)
	if not r.ok:
		status.emit(R.s(r.error), false)
		return
	if selected_edge == id:
		selected_edge = ""
	reload_requested.emit()


func remove_all() -> void:
	if busy:
		return
	_set_busy(true)
	_push_undo()
	var r := await _post({"removeAllEdges": true})
	_set_busy(false)
	if not r.ok:
		status.emit(R.s(r.error), false)
		return
	selected_edge = ""
	set_dirty(true)
	status.emit("All cabling removed", true)
	reload_requested.emit()


## Undo restores the graph AND screenDestinations as they were before the last cable action.
func undo() -> void:
	if busy:
		return
	if _undo.is_empty():
		status.emit("Nothing to undo", false)
		return
	var snap: Dictionary = _undo.pop_back()
	_set_busy(true)
	var r := await _post_settings({"deviceGraph": snap.graph, "screenDestinations": snap.screenDestinations})
	_set_busy(false)
	if not r.ok:
		status.emit(R.s(r.error), false)
		return
	set_dirty(true)
	status.emit("Undo successful", true)
	reload_requested.emit()


func can_undo() -> bool:
	return not _undo.is_empty()


## Apply always restarts Caspar (WO-440: force); while it runs (~10–20 s) `[Full apply] Step N` log lines are shown.
func apply_caspar() -> void:
	if busy:
		return
	applying = true
	_set_busy(true)
	status.emit("Applying Caspar config — restarting Caspar…", true)
	var r := await DevicesTarget.api.post_json("/api/caspar-config/apply", {"force": true})
	applying = false
	_set_busy(false)
	if not r.ok:
		status.emit(R.s(r.error) if R.s(r.error) != "" else "HTTP %d" % r.status, false)
		return
	set_dirty(false)
	var msg := R.s(R.d(r.data).get("message"))
	status.emit(msg if msg != "" else "Caspar config applied", true)


## WS log_line during an apply → "Applying: Step 2 …" (web applyCasparBtn progress).
func on_log_line(d: Variant) -> void:
	if not applying:
		return
	var line := R.s(R.d(d).get("line")) if d is Dictionary else R.s(d)
	var m := RegEx.create_from_string("\\[Full apply\\]\\s+(.{0,80})").search(line)
	if m:
		status.emit("Applying: " + m.get_string(1), true)


func set_dirty(v: bool) -> void:
	restart_dirty = v
	changed.emit()


## pushUndo: skipped unless both the graph and settings.screenDestinations are known (web parity).
func _push_undo() -> void:
	var sd: Variant = DevicesTarget.settings.settings.get("screenDestinations") if DevicesTarget.settings.is_loaded else null
	if not payload.get("graph") is Dictionary or sd == null:
		return
	_undo.append({"graph": payload.graph.duplicate(true), "screenDestinations": (sd as Dictionary).duplicate(true)
		if sd is Dictionary else sd})
	if _undo.size() > UNDO_MAX:
		_undo.pop_front()


func _post(body: Dictionary) -> Dictionary:
	return await DevicesTarget.api.post_json("/api/device-view", body)


func _post_settings(patch: Dictionary) -> Dictionary:
	var r := await DevicesTarget.api.post_json("/api/settings", patch)
	await DevicesTarget.settings.load_from_server()
	return r


func _take_graph(data: Variant) -> void:
	if data is Dictionary and data.get("graph") is Dictionary:
		payload.graph = data.graph


func _set_busy(v: bool) -> void:
	busy = v
	changed.emit()


func _canon(id: Variant) -> String:
	var c := R.canonical_id(payload, R.s(id))
	return c if c != "" else R.s(id)


## The graph edge with this id, {} when gone.
func edge(id: String) -> Dictionary:
	for e in R.a(R.d(payload.get("graph")).get("edges")):
		if e is Dictionary and R.s(e.get("id")) == id and id != "":
			return e
	return {}


func _edge_between(src: String, sink: String) -> String:
	for e in R.a(R.d(payload.get("graph")).get("edges")):
		if e is Dictionary and R.s(e.get("sourceId")) == src and R.s(e.get("sinkId")) == sink:
			return R.s(e.get("id"))
	return ""


func _layer(e: Dictionary) -> int:
	return preload("res://features/devices/devices_model.gd").output_layer(e)
