extends RefCounted
## WO-605 slice 3c — the pure half of the host-channel inspector's live-source controls: which extraLiveSources
## row a host destination is (device-view-host-channels-destination-utils.js), what the webpage / NDI / browser /
## DeckLink controls post (inspector-webpage-host.js, -ndi-host.js, -browser-display.js, -decklink-host.js,
## decklink-add-input.js), the shared source label (inspector-source-label.js, source-label.js) and the remove
## plans (extra-live-source-remove.js, removeDecklinkInputSlot). A plan is an ordered Array of requests:
## ["POST", path, body] (+ "soft" when the web ignores its failure) and ["DIRTY"] (markCasparRestartDirty).
## Golden-tested against the web modules run under Node: tests/test_devices_host_source.gd.

const R := preload("res://features/devices/cable_rules.gd")
const H := preload("res://features/devices/host_channels.gd")
const TEMPLATE_PATH := "/template/"
const UNASSIGNED := "unassigned"  # DECKLINK_IO_UNASSIGNED


## parseInt(dest.inputSlot) ≥ 1, else the number in `host_<tag>_input_N`; null otherwise.
static func _slot(d: Variant, tag: String) -> Variant:
	var dd := R.d(d)
	var n: Variant = H.js_int(H.coalesce([dd.get("inputSlot"), ""]))
	if n != null and n >= 1:
		return n
	var m := RegEx.create_from_string("^host_%s_input_(\\d+)$" % tag).search(R.s(dd.get("id")))
	if m == null:
		return null
	var k: Variant = H.js_int(m.get_string(1))
	return k if k != null and k != 0 else null


static func decklink_slot(d: Variant) -> Variant:
	return _slot(d, "decklink")


static func live_audio_slot(d: Variant) -> Variant:
	return _slot(d, "live_audio")


static func v4l2_slot(d: Variant) -> Variant:
	return _slot(d, "v4l2")


## findExtraLiveSourceForHostDestination — {} when none.
static func find_live_source(d: Variant, role: String, ch: Variant, extras: Variant) -> Dictionary:
	var list := R.a(extras).filter(func(x: Variant) -> bool: return x is Dictionary)
	if role == "decklink_input":
		var slot: Variant = decklink_slot(d)
		if slot != null:
			for x in list:
				if str(x.get("routeType")) == "decklink" and _num(x.get("decklinkSlot")) == float(slot):
					return x
		if ch != null:
			for x in list:
				if str(x.get("routeType")) == "decklink" and _num(x.get("inputsChannel")) == _num(ch):
					return x
		return {}
	var sid := R.s(R.d(d).get("sourceId"))
	if sid != "":
		for x in list:
			if R.s(x.get("sourceId")) == sid:
				return x
	if ch != null:
		for x in list:
			if _num(H.coalesce([x.get("hostChannel"), x.get("inputsChannel")])) == _num(ch) \
					and (str(x.get("routeType")) == role or str(x.get("hostRole")) == role):
				return x
	return {}


## JS Number(v): NAN for non-numbers (so two NaNs never compare equal, as in JS).
static func _num(v: Variant) -> float:
	if v is int or v is float:
		return float(v)
	if v is bool:
		return 1.0 if v else 0.0
	if v == null:
		return 0.0
	var m := RegEx.create_from_string("^\\s*[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?\\s*$").search(str(v))
	return m.get_string(0).to_float() if m else NAN


static func _str(v: Variant) -> String:  # String(v ?? '') without trimming
	return "" if v == null else R.s(v) if (v is int or v is float) else str(v)


# ---------------------------------------------------------------- webpage host

## playArg || templateOrUrl || ''
static func saved_page(source: Dictionary) -> String:
	return _str(H.coalesce([_truthy_or_null(source.get("playArg")), _truthy_or_null(source.get("templateOrUrl")), ""]))


static func _truthy_or_null(v: Variant) -> Variant:
	return v if H.truthy(v) else null


static func template_prefix(origin: String) -> String:
	return origin.rstrip("/") + TEMPLATE_PATH


static func is_template_url(value: String, origin: String) -> bool:
	return value.begins_with(template_prefix(origin))


## The template name a saved template URL points at ("" when it is a plain URL).
static func template_name(value: String, origin: String) -> String:
	if not is_template_url(value, origin):
		return ""
	var n := value.substr(template_prefix(origin).length())
	return n.substr(0, n.length() - 5) if n.ends_with(".html") else n


## The select's rows [[id, label]…] from the state's `templates` (id || label, blank skipped).
static func template_options(templates: Variant) -> Array:
	var out := [["", "— Select a template —"]]
	for t in R.a(templates):
		var td := R.d(t)
		var id := _str(H.coalesce([_truthy_or_null(td.get("id")), _truthy_or_null(td.get("label")), ""]))
		if id == "":
			continue
		out.append([id, _str(td.get("label")) if H.truthy(td.get("label")) else id])
	return out


## Reload / Enter: {body} for POST /api/host-live/webpage, or {error} (the web's warn toast).
static func webpage_request(source: Dictionary, use_template: bool, template: String, url_text: String, origin: String) -> Dictionary:
	var target := ""
	if use_template:
		var name := template.strip_edges()
		if name == "":
			return {"error": "Select a template"}
		target = template_prefix(origin) + (name.substr(0, name.length() - 5) if name.ends_with(".html") else name) + ".html"
	else:
		target = url_text.strip_edges()
		if target == "":
			return {"error": "Enter a page URL or select a template"}
	var body := {"sourceId": source.get("sourceId"), "value": source.get("value")}
	if target != saved_page(source).strip_edges():
		body.action = "update"
		body.templateOrUrl = target
	else:
		body.action = "reload"
	return {"body": body}


## The web copies the echoed source fields onto its row so the next request compares against them.
static func adopt(source: Dictionary, r: Variant, keys: Array) -> void:
	var src := R.d(R.d(r).get("source"))
	if src.is_empty():
		return
	for k in keys:
		source[k] = src.get(k)


# ---------------------------------------------------------------- NDI host

static func ndi_request(source: Dictionary, action: String, name_text: String) -> Dictionary:
	var name := name_text.strip_edges()
	if name == "" and action == "update":
		return {"error": "Enter or pick an NDI source name"}
	var body := {"sourceId": source.get("sourceId"), "value": source.get("value")}
	if action == "update":
		body.ndiName = name
		body.action = "update"
	else:
		body.action = "reload"
	return {"body": body}


static func ndi_message(r: Variant, action: String) -> String:
	var m: Variant = R.d(r).get("message")
	return _str(m) if H.truthy(m) else ("NDI reloaded" if action == "reload" else "NDI source updated")


## GET /api/ndi/list → names (`sources`, else `list`).
static func ndi_names(r: Variant) -> Array:
	var d := R.d(r)
	var list: Variant = d.get("sources") if d.get("sources") is Array else d.get("list")
	return R.a(list).map(func(n: Variant) -> String: return _str(n))


# ---------------------------------------------------------------- browser display

## Initial field texts (defaults 1152 / 648 / 25 when the row has none).
static func browser_fields(source: Dictionary) -> Dictionary:
	return {"url": _str(source.get("url")), "width": _str(source.get("width") if H.truthy(source.get("width")) else 1152),
		"height": _str(source.get("height") if H.truthy(source.get("height")) else 648), "fps": _str(source.get("fps") if H.truthy(source.get("fps")) else 25)}


## Apply: {body} for POST /api/host-live/browser (width ≥ 160, height ≥ 120, fps 1..60; garbage → defaults), or {error}.
static func browser_request(source: Dictionary, url_text: String, w: String, h: String, f: String) -> Dictionary:
	var url := url_text.strip_edges()
	if url == "":
		return {"error": "Enter a URL"}
	return {"body": {"sourceId": source.get("sourceId"), "value": source.get("value"), "action": "update", "url": url,
		"width": maxi(160, _int_or(w, 1152)), "height": maxi(120, _int_or(h, 648)), "fps": maxi(1, mini(60, _int_or(f, 25)))}}


## parseInt(String(text || def), 10) || def
static func _int_or(text: String, def: int) -> int:
	var n: Variant = H.js_int(text if text != "" else str(def))
	return n if n != null and n != 0 else def


static func browser_message(r: Variant) -> String:
	var d := R.d(r)
	var play := R.d(d.get("hostLivePlay"))
	if play.get("ok") is bool and not play.ok and H.truthy(play.get("error")):
		return "Applied, but: " + _str(play.error)
	return _str(d.message) if H.truthy(d.get("message")) else "Browser source updated"


static func interact_body(source: Dictionary) -> Dictionary:
	return {"sourceId": source.get("sourceId"), "action": "toggle"}


## POST /api/host-live/browser/interact reply → {ok, text (button), message, error}.
static func interact_outcome(r: Variant) -> Dictionary:
	var d := R.d(r)
	if H.truthy(d.get("ok")):
		var on: bool = str(d.get("action")) == "interact"
		return {"ok": true, "text": "Return to background" if on else "Move to operator monitor",
			"message": _str(d.message) if H.truthy(d.get("message")) else ("Moved to operator monitor" if on else "Returned to background")}
	return {"ok": false, "error": _str(d.get("error")) if H.truthy(d.get("error")) else ""}


# ---------------------------------------------------------------- DeckLink host

static func decklink_connectors(payload: Dictionary) -> Array:
	var all := R.a(R.d(payload.get("graph")).get("connectors")) + R.a(R.d(payload.get("suggested")).get("connectors"))
	return all.filter(func(c: Variant) -> bool: return c is Dictionary and str(c.get("kind")) == "decklink_io")


## source.decklinkDevice, else settings decklink_input_<slot>_device, else the slot number.
static func decklink_active_device(source: Dictionary, settings: Variant, slot: int) -> int:
	var n: Variant = H.js_int(H.coalesce([source.get("decklinkDevice"), 0]))
	if n != null and n != 0:
		return n
	var cs := R.d(R.d(settings).get("casparServer"))
	var s: Variant = H.js_int(H.coalesce([cs.get("decklink_input_%d_device" % slot), 0]))
	return s if s != null and s > 0 else slot


## buildDeviceOptions: [[device, label]…] — connectors' externalRef (else slot), unique, the active device first
## when it is not listed, `Device <slot>` when there are no connectors at all.
static func decklink_options(payload: Dictionary, slot: int, active: int) -> Array:
	var out := []
	var seen := {}
	for c in decklink_connectors(payload):
		var s: int = H._connector_slot(c)
		var n: Variant = H.js_int(H.coalesce([c.get("externalRef"), 0]))
		var dev: int = n if n != null and n != 0 else s
		if dev > 0 and not seen.has(dev):
			seen[dev] = true
			out.append([dev, _str(c.label) if H.truthy(c.get("label")) else "SDI %d" % s])
	if active > 0 and not seen.has(active):
		out.push_front([active, "Device %d" % active])
	if out.is_empty() and slot > 0:
		out.append([slot, "Device %d" % slot])
	return out


## changeDecklinkInputDevice's body ({} when slot or device < 1); connectorId / value only when present.
static func decklink_update_body(slot: Variant, device: Variant, connector_id: Variant, value: Variant) -> Dictionary:
	var s: Variant = H.js_int(H.coalesce([slot, ""]))
	var d: Variant = H.js_int(H.coalesce([device, ""]))
	if s == null or s < 1 or d == null or d < 1:
		return {}
	var body := {"action": "update", "slot": s, "decklinkDevice": d}
	return _with_ids(body, connector_id, value)


static func decklink_reload_body(slot: Variant, connector_id: Variant, value: Variant) -> Dictionary:
	var s: Variant = H.js_int(H.coalesce([slot, ""]))
	if s == null or s < 1:
		return {}
	return _with_ids({"action": "reload", "slot": s}, connector_id, value)


static func _with_ids(body: Dictionary, connector_id: Variant, value: Variant) -> Dictionary:
	if H.truthy(connector_id):
		body.connectorId = connector_id
	if H.truthy(value):
		body.value = value
	return body


## findDecklinkConnectorForDevice — {} when none.
static func find_decklink_connector(payload: Dictionary, dev: int, preferred_slot: int = 0) -> Dictionary:
	var cs := decklink_connectors(payload)
	if cs.is_empty():
		return {}
	if preferred_slot > 0:
		for c in cs:
			if H._connector_slot(c) == preferred_slot:
				return c
	if dev > 0:
		for c in cs:
			if H.js_int(H.coalesce([c.get("externalRef"), 0])) == dev:
				return c
		if dev <= cs.size():
			for c in cs:
				if H._connector_slot(c) == dev:
					return c
			return cs[dev - 1]
	return {}


# ---------------------------------------------------------------- source label (WO-525 / WO-534)

## readSourceLabelState: {custom, generated} for the extraLiveSources row with this connector id.
static func label_state(sources: Variant, connector_id: String, fallback: String = "") -> Dictionary:
	var key := connector_id.strip_edges()
	var mine := {}
	for s in R.a(sources):
		if s is Dictionary and _str(s.get("connectorId")) == key:
			mine = s
			break
	var is_custom := H.truthy(mine.get("labelIsCustom"))
	var custom := _str(mine.get("label")).strip_edges() if is_custom else ""
	var generated := _str(mine.get("generatedLabel")) if H.truthy(mine.get("generatedLabel")) else ("" if is_custom else _str(mine.get("label")))
	generated = generated.strip_edges()
	return {"custom": custom, "generated": generated if generated != "" else fallback}


## applySavedSourceLabel: fold the echoed label into the row (blank clears the override).
static func apply_saved_label(list: Variant, connector_id: String, label: Variant) -> void:
	for s in R.a(list):
		if s is Dictionary and _str(s.get("connectorId")) == connector_id.strip_edges():
			var custom := _str(label).strip_edges()
			if custom != "":
				s.label = custom
				s.labelIsCustom = true
			else:
				var g := _str(s.get("generatedLabel")).strip_edges()
				s.label = g if g != "" else s.get("label")
				s.labelIsCustom = false
			return


## shortLabelPill: the first three characters, nothing else (owner 13.08).
static func short_pill(label: Variant) -> String:
	return _str(label).strip_edges().substr(0, 3)


static func label_hint(custom: String, generated: String) -> String:
	var shown := custom if custom != "" else generated
	if shown == "":
		return ""
	var pill := short_pill(shown)
	return "Top-bar chip: " + (pill if pill != "" else "—")


# ---------------------------------------------------------------- stop / remove plans

static func stop_cmds(ch: Variant, layer: Variant) -> Array:
	var cl := "%s-%s" % [R.s(ch), R.s(layer)]
	return [["POST", "/api/raw", {"cmd": "STOP " + cl}, "soft"], ["POST", "/api/raw", {"cmd": "MIXER %s CLEAR" % cl}, "soft"]]


## stopHostChannelPlayback: hostChannel ?? inputsChannel on hostLayer ?? inputsLayer ?? 1.
static func host_stop(source: Dictionary) -> Array:
	var ch: Variant = H.coalesce([source.get("hostChannel"), source.get("inputsChannel")])
	if ch == null:
		return []
	return stop_cmds(ch, H.coalesce([source.get("hostLayer"), source.get("inputsLayer"), 1]))


## removeExtraLiveHostSource: {requests} or {error}. `fs` = state.hostOperatorFullscreen.
static func remove_live_plan(source: Dictionary, fs: Variant) -> Dictionary:
	var value := _str(source.get("value")).strip_edges()
	if value == "":
		return {"error": "Live source route missing"}
	var reqs := host_stop(source)
	var f := R.d(fs)
	if H.truthy(f.get("active")) and _str(f.get("sourceId")) == _str(source.get("sourceId")) and H.truthy(source.get("sourceId")):
		reqs.append(["POST", "/api/host-live/operator-fullscreen", {"action": "off", "sourceId": source.get("sourceId")}, "soft"])
	reqs.append(["POST", "/api/device-view", {"removeExtraLiveSource": {"value": value}}])
	reqs.append(["DIRTY"])
	return {"requests": reqs}


## removeDecklinkInputSlot, the part between the device-view read and the settings re-read: {requests, dest_id,
## connector_id, slot}. `cm` = the state channelMap under the payload's live one. The caller then compares the
## decklink_input_count before / after (DIRTY when it shrank), posts removeDestination {id: dest_id} and reloads.
static func decklink_remove_plan(dv: Dictionary, slot_hint: int, connector_id: String, live_value: String, destination_id: String, cm: Dictionary) -> Dictionary:
	var dest_id := destination_id.strip_edges() if destination_id.strip_edges() != "" else H.destination_id("decklink_input", 1, slot_hint)
	var reqs := []
	var sink := "dst_in_" + dest_id if dest_id != "" else ""
	for e in R.a(R.d(dv.get("graph")).get("edges")):
		if sink != "" and e is Dictionary and _str(e.get("sourceId")) == sink and H.truthy(e.get("id")):
			reqs.append(["POST", "/api/device-view", {"removeEdge": {"id": e.id}}, "soft"])
	var connector := {}
	if connector_id.strip_edges() != "":
		for c in R.a(R.d(dv.get("graph")).get("connectors")) + R.a(R.d(dv.get("suggested")).get("connectors")):
			if c is Dictionary and _str(c.get("id")) == connector_id:
				connector = c
				break
	if connector.is_empty():
		connector = find_decklink_connector(dv, 0, slot_hint)
	var resolved: int = H._connector_slot(connector) if not connector.is_empty() else slot_hint
	var cid := _str(connector.get("id")).strip_edges() if H.truthy(connector.get("id")) else connector_id.strip_edges()
	var live := {}
	var extras := R.a(dv.get("extraLiveSources")).filter(func(x: Variant) -> bool: return x is Dictionary)
	if live_value != "":
		for x in extras:
			if _str(x.get("value")) == live_value:
				live = x
				break
	if live.is_empty():
		for x in extras:
			if str(x.get("routeType")) == "decklink" and _num(x.get("decklinkSlot")) == float(resolved):
				live = x
				break
	var entry := H.decklink_entry(cm, resolved)
	var layer: Variant = H.coalesce([entry.get("layer"), resolved])
	if entry.get("channel") != null:
		reqs.append_array(stop_cmds(entry.channel, layer))
	var route := _str(live.get("value")) if H.truthy(live.get("value")) else \
		(_str(entry.get("route")) if H.truthy(entry.get("route")) else ("route://%s-%s" % [R.s(entry.channel), R.s(layer)] if entry.get("channel") != null else ""))
	if route != "":
		reqs.append(["POST", "/api/device-view", {"removeExtraLiveSource": {"value": route}}, "soft"])
	if cid != "":
		reqs.append(["POST", "/api/device-view", {"updateConnector": {"id": cid, "patch": {"caspar": {"ioDirection": UNASSIGNED}}}}])
	return {"requests": reqs, "dest_id": dest_id, "connector_id": cid, "slot": resolved}


## The tail after the settings re-read.
static func decklink_remove_tail(prev_count: int, next_count: int, dest_id: String) -> Array:
	var reqs := []
	if next_count < prev_count:
		reqs.append(["DIRTY"])
	if dest_id != "":
		reqs.append(["POST", "/api/device-view", {"removeDestination": {"id": dest_id}}, "soft"])
	return reqs


static func decklink_count(settings: Variant) -> int:
	var n: Variant = H.js_int(H.coalesce([R.d(R.d(settings).get("casparServer")).get("decklink_input_count"), 0]))
	return maxi(0, n if n != null else 0)
