extends RefCounted
## WO-605 slice 9b-2 — the GPU page's layout editor (web device-view-inspector-gpu-layout-editor.js) and the rear
## panel's GPU edit actions (device-view-caspar-render.js Show all / Clear layout, -markers.js label drag), over an
## injected `io` so the page and the golden replay share them:
##   io.post_json(path, body) → {ok, data, error}   io.confirm(text) → bool   io.reload()   io.status(text, ok)
##   io.prefs_save(items)   io.prefs_clear()   io.save_file(name, text) → ""|error   (this client's saved layout)
## `items` are the editor rows ({id, label, pairs, type, hidden}); their order is the socket order the server keeps
## as `gpuPhysicalTopology`. Godot departures from the web, on purpose (WO-605 slice 9b-2):
##   a failed topology / persist POST is reported (the web logs it and still says "saved"); the web's alerts go to
##   the status line; after Reset layout the page re-reads its rows (`stale`; the web keeps the old Hide ticks while
##   the saved layout they came from is gone); the rear label drag also saves the topology (the web's swap only wrote localStorage, which
##   the topology order overrides on the next load, so it never stuck).

const GL := preload("res://features/devices/gpu_layout.gd")
const E := preload("res://features/devices/gpu_entries.gd")
const R := preload("res://features/devices/cable_rules.gd")
const H := preload("res://features/devices/host_channels.gd")

const HEADING := "GPU layout — one row per physical socket. Port A/B are RandR alternates on the same jack (only one cable per slot)."
const UNMAPPED_HEADING := "Unmapped live displays — assign to a socket"
const ASSIGN_TIP := "Map this display onto the selected socket and save topology"
const BULK := [["Show all", "Show every GPU port on the rear panel and in the outputs list"],
	["Hide disconnected", "Hide ports with no active display"], ["Hide all", "Hide every GPU port (use Show all to restore)"]]
const RESET_TIP := "Clear saved layout and rebuild from detected GPU outputs (optional server xrandr refresh)"
const NO_DISCOVERY := "No discovered topology from server. Clear saved layout and rebuild from live data?"
const CLEAR_CONFIRM := "Clear saved GPU layout and rebuild from detected outputs?"
const SAVED := "GPU layout saved (topology persisted)"
const RESET_PATH := "/api/system/gpu-ports-reset"

var items: Array = []
var options: Array = []  # Port A / B names ("" = None goes first in the UI)
var live: Variant
var gpu_outs: Array = []
var saved_topology: Variant
var model := ""
var io: Variant
var stale := false  # a reset cleared this client's layout: the page re-reads its rows instead of keeping these


## The editor over a device-view payload (suggested gpu outs, the payload's own topology — web parity) and this
## client's saved layout list.
func _init(payload: Dictionary, saved_list: Array, io_: Variant) -> void:
	io = io_
	live = payload.get("live")
	gpu_outs = suggested_outs(payload)
	saved_topology = payload.get("gpuPhysicalTopology") if H.truthy(payload.get("gpuPhysicalTopology")) else null
	model = E.s(E.gpu_live(live).get("model")).to_upper()
	items = GL.layout_items(GL.entries(live, gpu_outs, [], saved_topology, GL.prefs_of(saved_list)))
	options = GL.port_options(live)


static func suggested_outs(payload: Dictionary) -> Array:
	return R.a(R.d(payload.get("suggested")).get("connectors")).filter(func(c: Variant) -> bool:
		return c is Dictionary and c.get("deviceId") == "caspar_host" and c.get("kind") == "gpu_out")


func rows() -> Array:
	var out := []
	for i in items.size():
		var p := R.a(items[i].get("pairs"))
		out.append({"head": "Socket %d (%s)" % [i + 1, E.s(items[i].get("label"))], "a": E.s(p[0] if p.size() > 0 else ""),
			"b": E.s(p[1] if p.size() > 1 else ""), "hidden": H.truthy(items[i].get("hidden"))})
	return out


## Live displays the physical map could not place: [{name, sockets}] (sockets = the gpu_pN rows to assign to).
func unmapped() -> Array:
	var sockets := items.map(func(x: Dictionary) -> String: return E.s(x.get("id"))) \
		.filter(func(id: String) -> bool: return E.re(E._GPU_P, id) != null)
	var out := []
	for p in R.a(E.pmap(live).get("ports")):
		if not H.truthy(R.d(p).get("unmapped")):
			continue
		var rt := R.d(p.get("runtime"))
		var name := E.s(E.or_([rt.get("xrandrName"), rt.get("activePort"), R.d(p.get("pair")).get("dpA"), ""]))
		if name != "":
			out.append({"name": name, "sockets": sockets})
	return out


## Any Port A / Port B / Hide change on row `i` (web triggerChange reads all three controls).
func edit(i: int, a: String, b: String, hidden: bool) -> void:
	var pairs := [a, b].filter(func(p: String) -> bool: return p != "")
	var item: Dictionary = items[i]
	var label := E.s(item.get("id"))
	var hdmi := pairs.any(func(p: String) -> bool: return p.to_upper().contains("HDMI"))
	var edp := pairs.any(func(p: String) -> bool: return p.to_upper().contains("EDP"))
	if not pairs.is_empty():
		label = " · ".join(pairs) if edp else "%s %s" % ["HDMI" if hdmi else "DP",
			"/".join(pairs.map(func(p: String) -> String: return "-".join(p.split("-").slice(1))))]
	item.pairs = pairs
	item.label = label
	item.type = "hdmi" if hdmi else ("edp" if edp else "dp")
	item.hidden = hidden
	await save()


## Drop row `from` on row `to`'s upper (after = false) or lower half.
func move(from: int, to: int, after: bool) -> void:
	if from == to:
		return
	var at := to + (1 if after else 0)
	if from < at:
		at -= 1
	if at == from:
		return
	var it: Variant = items.pop_at(from)
	items.insert(at, it)
	await save()


func bulk(which: String) -> void:
	var names := {}
	for d in R.a(E.gpu_live(live).get("displays")):
		if H.truthy(R.d(d).get("connected")) and E.s(d.get("name")) != "":
			names[E.s(d.name).to_upper()] = true
	for item in items:
		item.hidden = which == "Hide all" or (which == "Hide disconnected" and not R.a(item.get("pairs")).any(
			func(p: Variant) -> bool: return names.has(E.s(p).to_upper())))
	await save()


func assign(display: String, socket: String) -> void:
	var item: Variant = null
	for x in items:
		if E.s(x.get("id")) == socket:
			item = x
	if item == null:
		return
	var pairs := R.a(item.get("pairs")).duplicate()
	if not H.truthy(pairs[0] if pairs.size() > 0 else null):
		_put(pairs, 0, display)
	elif not H.truthy(pairs[1] if pairs.size() > 1 else null) and pairs[0] != display:
		_put(pairs, 1, display)
	else:
		pairs[0] = display
	item.pairs = pairs.filter(func(p: Variant) -> bool: return H.truthy(p))
	await save()


static func _put(a: Array, i: int, v: Variant) -> void:
	while a.size() <= i:
		a.append(null)
	a[i] = v


## saveAndRefresh: this client's layout, then the topology the server keeps.
func save() -> void:
	io.prefs_save(items.duplicate(true))
	var err := await _post_topology()
	io.status(SAVED if err == "" else "GPU layout saved on this client; topology not saved: " + err, err == "")
	await io.reload()


## "" when saved (or nothing to save), else the request's error.
func _post_topology() -> String:
	var topo := GL.to_topology(items)
	if topo.is_empty():
		return ""
	var r: Dictionary = await io.post_json("/api/settings", {"gpuPhysicalTopology": topo})
	return "" if r.ok else str(r.error)


func export_name() -> String:
	var m := model if model != "" else E.s(E.gpu_live(live).get("model"))
	var rx := RegEx.create_from_string("\\s+")
	return rx.sub("%s_%dports_layout.json" % [m if m != "" else "NVIDIA_GPU", items.size()], "_", true)


func export_text() -> String:
	return JSON.stringify(items, "  ", false)


## A loaded Export file: merge it over the rows (file order first), save both, report.
func load_text(text: String) -> void:
	var j := JSON.new()
	if j.parse(text) != OK:
		io.status("Invalid GPU layout file: %s (line %d)" % [j.get_error_message(), j.get_error_line() + 1], false)
		return
	if not j.data is Array:
		io.status("GPU layout file must be a JSON array (same format as Export).", false)
		return
	items = merge_loaded(items, j.data)
	io.prefs_save(items.duplicate(true))
	var err := await _post_topology()
	io.status("GPU layout loaded from file." if err == "" else "GPU layout loaded on this client; topology not saved: " + err, err == "")
	await io.reload()


## mergeLoadedGpuLayout: each object row with an id lands over the row with that id (or appends); rows named in the
## file come first, in file order.
static func merge_loaded(current: Array, raw: Array) -> Array:
	var arr := raw.filter(func(x: Variant) -> bool: return x is Dictionary)
	var by_id := {}
	for x in current:
		by_id[x.id] = x
	var order := []
	for item in arr:
		var id := E.s(item.get("id"))
		if id == "":
			continue
		var m: Dictionary = R.d(by_id.get(id)).duplicate(true)
		for k in item:
			m[k] = item[k]
		by_id[id] = m
		order.append(id)
	var dec := []
	for v in by_id.values():
		var i := order.find(v.id)
		dec.append([i if i >= 0 else 9999, dec.size(), v])
	if not order.is_empty():
		dec.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0] or (a[0] == b[0] and a[1] < b[1]))
	return dec.map(func(x: Array) -> Dictionary: return x[2])


static func layout_rows(list: Array) -> String:
	return "\n".join(list.map(func(x: Variant) -> String:
		var p := ", ".join(R.a(R.d(x).get("pairs")).filter(func(v: Variant) -> bool: return H.truthy(v)).map(func(v: Variant) -> String: return str(v)))
		return "  %s: %s" % [E.s(R.d(x).get("id")), p if p != "" else "(empty)"]))


## Reset layout: ask the server to rediscover; no discovery → rebuild from live data; else confirm the diff, take the
## discovered sockets and have the server persist them (or save the topology ourselves).
func reset() -> void:
	var r: Dictionary = await io.post_json(RESET_PATH, {})
	var found := R.a(R.d(r.data).get("pairs")) if r.ok else []
	if found.is_empty():
		if not await io.confirm(NO_DISCOVERY):
			return
		io.prefs_clear()
		stale = true
		items = GL.items_from_live(live, gpu_outs, saved_topology)
		io.status("GPU layout reset from live data (server discovery unavailable).", true)
		await io.reload()
		return
	var cur := layout_rows(items)
	if not await io.confirm("Current saved layout:\n%s\n\nDiscovered layout:\n%s\n\nReplace with discovered layout and save to server?"
			% [cur if cur != "" else "  (empty)", layout_rows(found)]):
		return
	io.prefs_clear()
	stale = true
	items = merge_loaded(items, found)
	var p: Dictionary = await io.post_json(RESET_PATH, {"persist": true})
	var err := ""
	if not (p.ok and H.truthy(R.d(p.data).get("persisted"))):
		err = await _post_topology()
	io.status("GPU layout reset from discovery and saved to server." if err == "" else "GPU layout reset from discovery; saving to server failed: " + err, err == "")
	await io.reload()


# ---------------------------------------------------------------- the rear panel's GPU edit actions


## Show all (rear header): every port visible in this client's layout; the topology is left alone (web).
static func show_all(live_: Variant, suggested_outs: Array) -> Array:
	return GL.items_from_live(live_, suggested_outs, null).map(func(x: Dictionary) -> Dictionary:
		var y := x.duplicate(true)
		y.hidden = false
		return y)


## Clear layout (rear header): confirm, forget this client's layout, ask the server to rediscover (reply ignored).
static func clear_layout(io_: Variant) -> void:
	if not await io_.confirm(CLEAR_CONFIRM):
		return
	io_.prefs_clear()
	await io_.post_json(RESET_PATH, {})
	io_.status("GPU layout cleared — refreshed from detected outputs", true)
	await io_.reload()


## A rear GPU label dropped on another: swap the two sockets, save this client's layout and the topology.
func swap(a: String, b: String) -> void:
	var i := -1
	var j := -1
	for k in items.size():
		if E.s(items[k].get("id")) == a:
			i = k
		if E.s(items[k].get("id")) == b:
			j = k
	if i < 0 or j < 0 or i == j:
		return
	var t: Variant = items[i]
	items[i] = items[j]
	items[j] = t
	await save()
