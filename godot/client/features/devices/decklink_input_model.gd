extends RefCounted
## WO-605 slice 5 — the DeckLink connector page's input side (web device-view-inspector-decklink-input.js and
## addDecklinkInputSlot in lib/decklink-add-input.js): the Input section's spec items, the Stop input arguments
## (the remove itself is host_source_model.gd's decklink_remove_plan) and the Start an input plan, split where the
## web re-reads the server: add_prepare (before the ioDirection write) and add_finish (after the settings and
## device-view re-read). Pure: no autoloads.

const R := preload("res://features/devices/cable_rules.gd")
const H := preload("res://features/devices/host_channels.gd")
const HS := preload("res://features/devices/host_source_model.gd")


static func _pi(v: Variant) -> int:
	var n: Variant = H.js_int(v if v != null else "0")
	return n if n != null else 0


## {io, dev, slot, cm, entry}: the port's direction, Caspar device (externalRef), SDI slot, the channel map the web
## reads (live, else the planned settings one) and that map's decklink input entry for the slot ({} = none).
static func view(conn: Dictionary, payload: Dictionary, settings: Variant) -> Dictionary:
	var live: Variant = R.d(R.d(payload.get("live")).get("caspar")).get("channelMap")
	var planned: Variant = R.d(settings).get("channelMap")
	var cm: Dictionary = live if live is Dictionary else (planned if planned is Dictionary else {})
	var slot := H._connector_slot(conn)
	return {"io": H._io_direction(conn.get("caspar")), "dev": _pi(conn.get("externalRef")), "slot": slot, "cm": cm,
		"entry": H.decklink_entry(cm, slot)}


## The live source the host-channel device switcher gets (the dedicated slot's settings device, else the port's).
static func host_source(conn: Dictionary, v: Dictionary, settings: Variant) -> Dictionary:
	var cs := R.d(R.d(settings).get("casparServer"))
	var raw: Variant = cs.get("decklink_input_%d_device" % v.slot)
	var dev := _pi(raw if raw != null else v.dev)
	var e: Dictionary = v.entry
	return {"value": str(e.route) if H.truthy(e.get("route")) else "", "decklinkDevice": dev if dev != 0 else v.dev,
		"decklinkSlot": v.slot, "connectorId": conn.get("id"), "inputsChannel": e.get("channel")}


static func input_items(conn: Dictionary, payload: Dictionary, settings: Variant) -> Array:
	var v := view(conn, payload, settings)
	var items := [{"t": "heading", "text": "Input"}]
	if v.io == "in":
		items.append({"t": "label"})
		items.append({"t": "button", "text": "Stop input"})
		if v.entry.get("channel") != null:
			items.append({"t": "host", "slot": v.slot, "source": host_source(conn, v, settings)})
		return items
	if v.entry.is_empty() and v.io != "unassigned":
		items.append({"t": "note", "text": "Set decklink_input_count ≥ %d in Settings, then apply Caspar config." % v.slot})
	items.append({"t": "button", "text": "Start an input"})
	return items


## Stop input's removeDecklinkInputSlot arguments: [slot, connector id, live source value].
static func stop_args(conn: Dictionary, v: Dictionary) -> Array:
	var route: String = str(v.entry.route) if H.truthy(v.entry.get("route")) else "decklink://%d" % v.dev
	return [v.slot, str(conn.get("id", "")), route]


static func stop_status(v: Dictionary) -> String:
	return "Port %d: unassigned." % v.dev


# ---------------------------------------------------------------- Start an input

## addDecklinkInputSlot up to the ioDirection write. `dv` = the fresh GET /api/device-view. {error} or
## {connector, connector_id, slot, dev, already_input, tile, requests}.
static func add_prepare(dv: Dictionary, device: int, slot: int) -> Dictionary:
	if slot <= 0 and device <= 0:
		return {"error": "Pick an SDI port"}
	var c := HS.find_decklink_connector(dv, device, slot)
	if not H.truthy(c.get("id")):
		return {"error": "No DeckLink connector for SDI port %d — open Device View and refresh" % slot if slot > 0
			else "No DeckLink connector — open Device View and refresh"}
	var cid := R.s(c.id)
	var resolved := H._connector_slot(c)
	var dev: Variant = H.js_int(c.get("externalRef") if c.get("externalRef") != null else resolved)
	var tile := {}
	for x in R.a(dv.get("extraLiveSources")):
		if x is Dictionary and (R.s(x.get("connectorId")) == cid or (str(x.get("routeType")) == "decklink" and HS._num(x.get("decklinkSlot")) == float(resolved))):
			tile = x
			break
	return {"connector": c, "connector_id": cid, "slot": resolved, "dev": maxi(1, dev if dev != null and dev != 0 else resolved),
		"already_input": H._io_direction(c.get("caspar")) == "in", "tile": tile,
		"requests": [["POST", "/api/device-view", {"updateConnector": {"id": cid, "patch": {"caspar": {"ioDirection": "in"}}}}]]}


## The rest, after the settings re-read (`prev` / `next` = decklink_input_count before / after) and the device-view
## re-read `dv`. {requests, host_channel, route (the live source's value), restart (count grew), pending,
## already (the port was already a live input — capture refreshed)}.
static func add_finish(prep: Dictionary, prev: int, next: int, dv: Dictionary, settings: Variant) -> Dictionary:
	var slot: int = prep.slot
	var runtime_cm := R.d(R.d(R.d(dv.get("live")).get("caspar")).get("channelMap")).duplicate()
	var planned := runtime_cm.duplicate()
	planned.merge(R.d(R.d(settings).get("channelMap")), true)
	var entry := H.decklink_entry(planned, slot)
	var runtime := H.decklink_entry(runtime_cm, slot)
	var reqs := []
	if next > prev:
		reqs.append(["DIRTY"])
		reqs.append(_add_live(entry, prep))
		return {"requests": reqs, "host_channel": entry.get("channel"), "route": _value(entry, prep), "restart": true, "pending": true}
	if prep.already_input and not prep.tile.is_empty() and runtime.get("channel") != null:
		var layer: Variant = H.coalesce([runtime.get("layer"), slot])
		var route: String = str(runtime.route) if H.truthy(runtime.get("route")) else "route://%s-%s" % [R.s(runtime.channel), R.s(layer)]
		if _pi(H.coalesce([prep.tile.get("decklinkDevice"), 0])) != prep.dev:
			reqs.append(["POST", "/api/host-live/decklink", {"action": "update", "slot": slot, "decklinkDevice": prep.dev,
				"connectorId": prep.connector_id, "value": route}])
		else:
			reqs.append_array(_play(runtime, slot, prep.dev))
		return {"requests": reqs, "host_channel": runtime.channel, "route": route, "restart": false, "pending": false, "already": true}
	var e := runtime if not runtime.is_empty() else entry
	if not H.truthy(e.get("channel")):
		reqs.append(_add_live(e, prep))
		return {"requests": reqs, "host_channel": e.get("channel"), "route": _value(e, prep), "restart": true, "pending": true}
	reqs.append_array(_play(e, slot, prep.dev))
	reqs.append(_add_live(e, prep))
	return {"requests": reqs, "host_channel": e.channel, "route": _value(e, prep), "restart": false, "pending": false}


## buildDecklinkLiveSource's value: the entry's route, else route://channel-layer, else decklink://device.
static func _value(entry: Dictionary, prep: Dictionary) -> String:
	var ch: Variant = entry.get("channel")
	return str(entry.route) if H.truthy(entry.get("route")) else \
		("route://%s-%s" % [R.s(ch), R.s(H.coalesce([entry.get("layer"), prep.slot]))] if ch != null else "decklink://%d" % prep.dev)


## buildDecklinkLiveSource as the addExtraLiveSource request.
static func _add_live(entry: Dictionary, prep: Dictionary) -> Array:
	var layer: Variant = H.coalesce([entry.get("layer"), prep.slot])
	var ch: Variant = entry.get("channel")
	var value := _value(entry, prep)
	var label: Variant = entry.get("label") if H.truthy(entry.get("label")) else \
		(prep.connector.label if H.truthy(prep.connector.get("label")) else "DeckLink %d" % prep.slot)
	return ["POST", "/api/device-view", {"addExtraLiveSource": {"type": "route", "routeType": "decklink", "value": value,
		"label": label, "decklinkSlot": prep.slot, "inputsChannel": ch, "inputsLayer": layer, "decklinkDevice": prep.dev,
		"connectorId": prep.connector_id}}]


## playDecklinkOnHost: STOP / MIXER CLEAR (failures ignored), then PLAY.
static func _play(entry: Dictionary, slot: int, dev: int) -> Array:
	var layer: Variant = H.coalesce([entry.get("layer"), slot])
	var reqs := HS.stop_cmds(entry.channel, layer)
	reqs.append(["POST", "/api/raw", {"cmd": "PLAY %s-%s DECKLINK %d" % [R.s(entry.channel), R.s(layer), dev]}])
	return reqs


## The page's status after a successful start (`dev` = the port's externalRef as the page read it).
static func add_status(dev: int, fin: Dictionary) -> String:
	var ch: Variant = fin.host_channel
	return "Port %d is input on ch %s.%s" % [dev, "null" if ch == null else R.s(ch),
		" Apply Caspar config and restart if the input does not appear." if fin.restart else ""]
