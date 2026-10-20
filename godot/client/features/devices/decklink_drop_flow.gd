extends RefCounted
## WO-605 slice 12 — a DeckLink connector dragged off the rear panel (web device-view-caspar-render-markers.js:
## `application/x-highascg-connector` = {connectorId, kind}) and dropped on a destination's output (web
## device-view-cable-outputs.js setDecklinkAsDestinationOutput) or on the Sources list (web
## sources-panel-decklink-drop.js mapDecklinkToLiveInput → addDecklinkInputSlot). The request sequences run over an
## injected `io` so the drop targets and the golden replay share them:
##   io.get_json(path) / io.post_json(path, body) → {ok, data, error}   io.load_settings() → the fresh settings
##   io.status(text, kind)  ("info" | "ok" | "error")   io.dirty()  (Caspar restart-dirty)   io.reload()
##   io.hint(text)  (the web's corner toast)   io.tab(name)  (switch workspace tab)
## Not ported: window.__highascgApplyExtraLiveSources — the web pushes the new extraLiveSources into its client state;
## here the device view / Store re-read carries them.

const MIME := "application/x-highascg-connector"
const DI := preload("res://features/devices/decklink_input_model.gd")
const H := preload("res://features/devices/host_channels.gd")
const R := preload("res://features/devices/cable_rules.gd")

var io: Variant


func _init(io_: Variant) -> void:
	io = io_


## The drag payload for a rear-panel decklink_io port (web marker dragstart outside DeckLink edit mode).
static func payload(connector_id: String) -> Dictionary:
	return {MIME: JSON.stringify({"connectorId": connector_id, "kind": "decklink_io"})}


## parseDecklinkDrop: the connector id a drop carries, else "" (no payload, bad JSON, not decklink_io, blank id).
static func parse(data: Variant) -> String:
	var raw: Variant = data.get(MIME, "") if data is Dictionary else ""
	if not raw is String or raw == "":
		return ""
	var j := JSON.new()  # quiet: a bad payload is just not a connector drop
	var p: Variant = j.data if j.parse(raw) == OK else null
	if not p is Dictionary or R.s(p.get("kind")) != "decklink_io":
		return ""
	return R.s(p.get("connectorId")).strip_edges()


## A destination's output takes the drop unless it is a stream destination.
static func accepts(dest: Dictionary) -> bool:
	return R.s(dest.get("mode")) != "stream"


## The connector patch for a drop on `dest` (`intent` = its destinationIntent item or null): multiview binds to the
## multiview, everything else to screen mainScreenIndex + 1 (a numeric intent index wins over the destination's).
static func destination_patch(dest: Dictionary, intent: Variant) -> Dictionary:
	var it := R.d(intent)
	var mode := R.s(dest.get("mode")) if H.truthy(dest.get("mode")) else (R.s(it.get("mode")) if H.truthy(it.get("mode")) else "pgm_prv")
	var main: Variant = it.get("mainScreenIndex")
	var idx: float
	if (main is int or main is float) and is_finite(float(main)):
		idx = float(main)
	else:
		var v: Variant = H.js_int(H.coalesce([dest.get("mainScreenIndex"), 0]))
		idx = maxf(0.0, float(v) if v != null and v != 0 else 0.0)
	var binding: Dictionary = {"type": "multiview"} if mode == "multiview" else {"type": "screen", "index": _num(maxf(1.0, idx + 1.0))}
	return {"caspar": {"ioDirection": "out", "outputBinding": binding}}


static func _num(f: float) -> Variant:
	return int(f) if f == floorf(f) else f


static func _err(r: Dictionary) -> String:
	var data: Variant = r.get("data")
	if data is Dictionary and H.truthy(data.get("error")):
		return str(data.error)
	return str(r.get("error", "HTTP %s" % r.get("status", "?")))


## setDecklinkAsDestinationOutput.
func to_destination(cid: String, dest: Dictionary, intent: Variant) -> void:
	if cid == "":
		return
	var r: Dictionary = await io.post_json("/api/device-view", {"updateConnector": {"id": cid, "patch": destination_patch(dest, intent)}})
	if not r.ok:
		io.status(_err(r), "error")
		return
	io.status("DeckLink %s mapped to destination output" % cid, "ok")
	io.dirty()
	io.reload()


## mapDecklinkToLiveInput: ioDirection 'in', the slot / device from the re-read connector, then addDecklinkInputSlot
## (decklink_input_model.gd — the same plan the connector page's "Start an input" runs).
func to_live_input(cid: String) -> void:
	if cid == "":
		return
	io.status("Mapping %s as live input…" % cid, "info")
	var r: Dictionary = await io.post_json("/api/device-view", {"updateConnector": {"id": cid, "patch": {"caspar": {"ioDirection": "in"}}}})
	if not r.ok:
		io.status(_err(r), "error")
		return
	var g: Dictionary = await io.get_json("/api/device-view")
	if not g.ok:
		io.status(_err(g), "error")
		return
	var dv := R.d(g.data)
	var c: Variant = null
	for x in R.a(R.d(dv.get("graph")).get("connectors")) + R.a(R.d(dv.get("suggested")).get("connectors")):
		if x is Dictionary and R.s(x.get("id")) == cid:
			c = x
			break
	var n: Variant = H.js_int(cid.trim_prefix("dli_"))
	var slot := H._connector_slot(c if c != null else ({"index": n - 1} if n != null else {}))
	var d: Variant = H.js_int(H.coalesce([R.d(c).get("externalRef"), slot]))
	var dev: int = maxi(1, d if d != null and d != 0 else slot)
	var prev := DI.HS.decklink_count(await io.load_settings())
	g = await io.get_json("/api/device-view")
	if not g.ok:
		io.status(_err(g), "error")
		return
	var prep := DI.add_prepare(R.d(g.data), dev, slot)
	if prep.has("error"):
		io.status(prep.error, "error")
		return
	if not await _run(prep.requests):
		return
	var settings: Variant = await io.load_settings()
	g = await io.get_json("/api/device-view")
	if not g.ok:
		io.status(_err(g), "error")
		return
	var fin := DI.add_finish(prep, prev, DI.HS.decklink_count(settings), R.d(g.data), settings)
	if not await _run(fin.requests):
		return
	if fin.restart or fin.pending:
		io.dirty()
	io.status("Live source ready: %s (%s)" % [fin.route, cid], "ok")
	io.hint("Ready in Live tab: %s (%s)" % [fin.route, cid])
	io.tab("live")


## A planned request list: ["DIRTY"] marks restart-dirty where it stands; a 4th "soft" element ignores that
## request's failure (the web's .catch(() => {})); any other failure is the drop's error status.
func _run(requests: Array) -> bool:
	for req in requests:
		if req[0] == "DIRTY":
			io.dirty()
			continue
		var r: Dictionary = await io.post_json(req[1], req[2])
		if not r.ok and req.size() < 4:
			io.status(_err(r), "error")
			return false
	return true
