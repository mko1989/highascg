extends RefCounted
## WO-605 slice 3 — which destinations the Devices tab lists: persisted screen destinations, then pinned host
## channels, then the auto-detected host channels (DeckLink / live-audio / USB inputs, webpage / NDI / browser hosts,
## generatedChannelOrder rows, destinationIntent rows). Ports device-view-host-channels.js (+ -inputs.js),
## planned-channel-map.js, input-channels.js and roleLabel (device-view-ui-utils.js). Pure (tests preload it).

const R := preload("res://features/devices/cable_rules.gd")
const ROLES := ["inputs_host", "streaming_channel", "extra_audio", "decklink_input", "live_audio_input", "v4l2_input",
	"webpage_host", "ndi_host", "browser_display"]
const ROLE_LABEL := {"multiview": "Multiview", "inputs_host": "Inputs host", "decklink_input": "DeckLink input",
	"live_audio_input": "Live audio input", "v4l2_input": "USB video input", "extra_audio": "Extra audio",
	"streaming_channel": "Streaming channel", "webpage_host": "Webpage host", "ndi_host": "NDI host",
	"browser_display": "Browser display"}
const LIVE_HOST_KINDS := ["webpage_host", "ndi_host", "browser_display"]


## JS parseInt(String(v), 10): leading-digit prefix of the text, null for NaN. JSON floats truncate like "3.5" → 3.
static func js_int(v: Variant) -> Variant:
	if v is int:
		return v
	if v is float:
		return int(v) if is_finite(v) else null
	var m := RegEx.create_from_string("^\\s*([+-]?\\d+)").search(R.s(v))
	return int(m.get_string(1)) if m else null


## `a ?? b ?? …` — the first value that is not null.
static func coalesce(values: Array) -> Variant:
	for v in values:
		if v != null:
			return v
	return null


static func truthy(v: Variant) -> bool:
	return not (v == null or (v is bool and not v) or ((v is int or v is float) and v == 0) or (v is String and v == ""))


static func is_host(d: Dictionary) -> bool:
	return R.s(d.get("mode")) == "host_channel" or d.get("virtual") == true


static func role_label(role: String, main_index: int = 0) -> String:
	match role:
		"pgm":
			return "Main %d OUTPUT/PGM" % (main_index + 1)
		"prv":
			return "Main %d PRV" % (main_index + 1)
		"bus1":
			return "Main %d Bus 1" % (main_index + 1)
		"bus2":
			return "Main %d Bus 2" % (main_index + 1)
	return ROLE_LABEL.get(role, role if role != "" else "channel")


static func destination_id(role: String, ch: Variant, slot: Variant = null) -> String:
	var c := R.s(ch)
	match role:
		"inputs_host":
			return "host_inputs"
		"streaming_channel":
			return "host_streaming"
		"extra_audio":
			return "host_extra_audio_" + c
		"decklink_input", "live_audio_input", "v4l2_input":
			var s: Variant = js_int(coalesce([slot, ""]))
			var tag: String = {"decklink_input": "decklink", "live_audio_input": "live_audio", "v4l2_input": "v4l2"}[role]
			return "host_%s_input_%d" % [tag, s] if s != null and s >= 1 else "host_%s_ch_%s" % [tag, c]
		"webpage_host", "ndi_host", "browser_display":
			var sid := R.s(coalesce([slot, ch, ""])).strip_edges()
			var tag: String = {"webpage_host": "webpage", "ndi_host": "ndi", "browser_display": "browser"}[role]
			return "host_%s_%s" % [tag, sid] if sid != "" else "host_%s_ch_%s" % [tag, c]
	return "host_%s_%s" % [role, c]


## defaultHostChannelLabel. `slot` null = absent; the normalizer passes "NaN" for an unparsable one, like the web.
static func default_label(role: String, ch: Variant, slot: Variant = null, label: Variant = null, source_id: Variant = null) -> String:
	var tail := " (ch %s)" % R.s(ch) if ch != null else ""
	if role == "decklink_input" and slot != null:
		return "DeckLink input %s%s" % [R.s(slot), tail]
	if role == "live_audio_input" and slot != null:
		return "Live audio input %s%s" % [R.s(slot), tail]
	if role == "v4l2_input" and slot != null:
		return "USB: %s%s" % [R.s(label) if truthy(label) else "USB video", tail]
	var named := {"webpage_host": ["Webpage: ", "Webpage"], "ndi_host": ["NDI: ", "NDI"], "browser_display": ["Browser: ", "Browser"]}
	if named.has(role):
		var name: String = R.s(label) if truthy(label) else (R.s(source_id) if truthy(source_id) else named[role][1])
		return named[role][0] + name + tail
	return role_label(role) + tail


## normalizeHostChannelDestination: a destinationIntent item / generated row → host destination, {} when not one.
static func normalize(item: Variant) -> Dictionary:
	if not item is Dictionary:
		return {}
	var role := R.s(item.get("hostRole") if truthy(item.get("hostRole")) else (item.get("role") if truthy(item.get("role")) else "")).strip_edges()
	if not role in ROLES:
		return {}
	var ch: Variant = js_int(coalesce([item.get("casparChannel"), item.get("ch"), item.get("pgmChannel"), ""]))
	if ch == null or ch < 1:
		return {}
	var slot: Variant = js_int(coalesce([item.get("slot"), item.get("inputSlot"), item.get("sourceId"), ""]))
	var id := R.s(item.get("id")).strip_edges() if truthy(item.get("id")) else ""
	if id == "":
		if role == "decklink_input" or role == "live_audio_input":
			id = destination_id(role, ch, slot)
		elif role in LIVE_HOST_KINDS:
			id = destination_id(role, ch, item.get("sourceId") if truthy(item.get("sourceId")) else (item.get("id") if truthy(item.get("id")) else null))
		else:
			id = destination_id(role, ch)
	var label := R.s(item.get("label")) if truthy(item.get("label")) else default_label(role, ch, slot if slot != null else "NaN")
	label = label.strip_edges()
	var out := {"id": id, "label": label if label != "" else id, "mode": "host_channel", "hostRole": role,
		"casparChannel": ch, "virtual": true}
	if truthy(item.get("sourceId")):
		out.sourceId = R.s(item.sourceId)
	if slot != null and slot >= 1:
		out.inputSlot = slot
	if truthy(item.get("devicePath")):
		out.devicePath = R.s(item.devicePath)
	return out


static func _num_eq(a: Variant, b: Variant) -> bool:
	return (a is int or a is float) and (b is int or b is float) and float(a) == float(b)


static func _entries(cm: Dictionary) -> Array:
	return R.a(cm.get("inputChannels")).filter(func(e: Variant) -> bool: return e is Dictionary)


static func _slot_entry(cm: Dictionary, kind: String, slot: Variant, arr_key: String, layer: Variant, route_layer: bool) -> Dictionary:
	if not (slot is int or slot is float) or slot < 1:
		return {}
	var n := int(slot)
	for e in _entries(cm):
		if e.get("kind") == kind and _num_eq(e.get("slot"), n):
			return e
	var arr := R.a(cm.get(arr_key))
	var ch: Variant = arr[n - 1] if arr.size() >= n else null
	if ch != null:
		var lyr: Variant = n if layer == null else layer
		return {"kind": kind, "slot": n, "channel": ch, "layer": lyr,
			"route": "route://%s-%s" % [R.s(ch), R.s(lyr)] if route_layer else "route://" + R.s(ch)}
	return {}


## decklinkInputForSlot: inputChannels entry, else decklinkInputChannels[n-1], else the legacy shared inputs host.
static func decklink_entry(cm: Dictionary, slot: Variant) -> Dictionary:
	var e := _slot_entry(cm, "decklink", slot, "decklinkInputChannels", null, true)
	if not e.is_empty() or not (slot is int or slot is float) or slot < 1:
		return e
	var shared: Variant = cm.get("inputsCh")
	var count: int = maxi(0, js_int(coalesce([cm.get("decklinkCount"), 0])) if js_int(coalesce([cm.get("decklinkCount"), 0])) != null else 0)
	if shared != null and int(slot) <= count:
		return {"kind": "decklink", "slot": int(slot), "channel": shared, "layer": int(slot),
			"route": "route://%s-%d" % [R.s(shared), int(slot)]}
	return {}


static func live_audio_entry(cm: Dictionary, slot: Variant) -> Dictionary:
	return _slot_entry(cm, "live_audio", slot, "liveAudioInputChannels", 10, false)


static func v4l2_entry(cm: Dictionary, slot: Variant) -> Dictionary:
	return _slot_entry(cm, "v4l2", slot, "v4l2InputChannels", 1, true)


static func _count(cm: Dictionary, key: String) -> int:
	var n: Variant = js_int(coalesce([cm.get(key), "0"]))
	return maxi(0, n if n != null else 0)


## listInputChannels: inputChannels when present, else synthesised from the per-kind arrays.
static func input_channels(cm: Dictionary) -> Array:
	var given := _entries(cm)
	if not R.a(cm.get("inputChannels")).is_empty():
		return given.filter(func(e: Dictionary) -> bool: return e.get("channel") != null)
	var out := []
	for spec in [["decklinkCount", decklink_entry], ["liveAudioCount", live_audio_entry], ["v4l2InputCount", v4l2_entry]]:
		for i in range(1, _count(cm, spec[0]) + 1):
			var e: Dictionary = spec[1].call(cm, i)
			if not e.is_empty():
				out.append(e)
	return out


## effectiveChannelMap: the planned (saved) map while host channels differ from the live one, else live.
static func channel_map(payload: Dictionary, live_cm: Variant) -> Dictionary:
	var live: Variant = live_cm if truthy(live_cm) else R.d(R.d(R.d(payload.get("live")).get("caspar"))).get("channelMap")
	live = live if live is Dictionary else null
	var planned: Variant = R.d(payload.get("_settings")).get("channelMap")
	if not planned is Dictionary:
		planned = R.d(R.d(payload.get("live")).get("caspar")).get("channelMap")
	planned = planned if planned is Dictionary else null
	var cm: Variant = (planned if planned != null else live) if pending_apply(planned, live) else (live if live != null else planned)
	return cm if cm is Dictionary else {}


## casparHostChannelsPendingApply (planned vs live map).
static func pending_apply(planned: Variant, live: Variant) -> bool:
	if planned == null:
		return false
	if live == null:
		return true
	for k in ["decklinkCount", "liveAudioCount", "v4l2InputCount"]:
		if float(coalesce([planned.get(k), 0])) != float(coalesce([live.get(k), 0])):
			return true
	for k in ["decklinkInputChannels", "liveAudioInputChannels", "v4l2InputChannels"]:
		if JSON.stringify(coalesce([planned.get(k), []])) != JSON.stringify(coalesce([live.get(k), []])):
			return true
	return JSON.stringify(_pick_hosts(planned)) != JSON.stringify(_pick_hosts(live))


## Number(v) for sorting: null → 0 like JS arithmetic; non-numbers sort first.
static func _js_num(v: Variant) -> float:
	return float(v) if v is int or v is float else 0.0


static func _pick_hosts(cm: Dictionary) -> Array:
	var out := []
	for e in _entries(cm):
		if R.s(e.get("kind")) in LIVE_HOST_KINDS:
			out.append({"kind": e.kind, "channel": e.get("channel"), "sourceId": e.get("sourceId")})
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return _js_num(a.channel) < _js_num(b.channel))
	return out


## hostChannelPendingApply (WO-381): "(planned)" only when the RUNNING Caspar reports no such channel.
static func channel_planned(ch: Variant, config_comparison: Variant) -> bool:
	var live := {}
	for row in R.a(R.d(config_comparison).get("serverChannels")):
		var n: Variant = js_int(coalesce([R.d(row).get("index"), ""]))
		if n != null and n >= 1:
			live[n] = true
	if live.is_empty():
		return false
	var c: Variant = js_int(coalesce([ch, ""]))
	return c != null and c >= 1 and not live.has(c)


static func _io_direction(v: Variant) -> String:
	var d := (R.s(v) if v is String else R.s(R.d(v).get("ioDirection")).strip_edges()).to_lower()
	return d if d == "out" or d == "in" else "unassigned"


static func _slot_live(row: Variant) -> bool:
	if not row is Dictionary or R.s(row.get("ioDirection")).to_lower() != "in":
		return false
	var dev: Variant = js_int(coalesce([row.get("device"), 0]))
	return dev != null and dev > 0


static func _deck_inputs(payload: Dictionary) -> Array:
	return R.a(R.d(R.d(payload.get("live")).get("decklink")).get("inputs"))


## activeDecklinkInputSlots — insertion-ordered and unique, like the web's Set.
static func _active_slots(payload: Dictionary) -> Array:
	var out := []
	for i in _deck_inputs(payload):
		if _slot_live(i):
			var n: Variant = i.get("slot")
			if (n is int or n is float) and n >= 1 and not out.has(int(n)):
				out.append(int(n))
	return out


## isDecklinkInputSlotActive: live inputs first, then the decklink_io connector, then the saved casparServer slots.
static func decklink_slot_active(payload: Dictionary, slot: Variant) -> bool:
	var n: Variant = js_int(coalesce([slot, ""]))
	if n == null or n < 1:
		return false
	for i in _deck_inputs(payload):
		if i is Dictionary and _num_eq(i.get("slot"), n):
			return _slot_live(i)
	var cs: Variant = R.d(payload.get("settings")).get("casparServer")
	if not truthy(cs):
		cs = R.d(payload.get("_settings")).get("casparServer")
	if not truthy(cs):
		cs = R.d(R.d(payload.get("live")).get("caspar")).get("channelMap")
	cs = R.d(cs)
	var configured := maxi(0, js_int(coalesce([cs.get("decklink_input_count"), 0])) if js_int(coalesce([cs.get("decklink_input_count"), 0])) != null else 0)
	for c in R.a(R.d(payload.get("graph")).get("connectors")) + R.a(R.d(payload.get("suggested")).get("connectors")):
		if c is Dictionary and c.get("kind") == "decklink_io" and _connector_slot(c) == n:
			return _io_direction(c.get("caspar")) == "in"
	if configured == 0 or _io_direction(R.s(cs.get("decklink_input_%d_direction" % n))) != "in":
		return false
	var dev: Variant = js_int(coalesce([cs.get("decklink_input_%d_device" % n), 0]))
	return dev != null and dev > 0 and n <= configured


## decklinkSlotFromConnector: 0-based index + 1, else the device number in externalRef, else 1.
static func _connector_slot(c: Dictionary) -> int:
	var idx: Variant = js_int(coalesce([c.get("index"), ""]))
	if idx != null and idx >= 0:
		return idx + 1
	var dev: Variant = js_int(coalesce([c.get("externalRef"), "0"]))
	return dev if dev != null and dev > 0 else 1


## listDecklinkAndLiveInputHostDestinations.
static func input_destinations(payload: Dictionary, cm: Dictionary) -> Array:
	if cm.is_empty():
		return []
	var active := _active_slots(payload)
	var deck_count := _count(cm, "decklinkCount")
	for s in active:
		deck_count = maxi(deck_count, s)
	var entries := []
	for slot in range(1, deck_count + 1):
		if not active.is_empty() and not active.has(slot):
			continue
		var e := decklink_entry(cm, slot)
		if e.get("channel") != null:
			entries.append(e)
	if entries.is_empty() and not active.is_empty():
		var order_ch: Variant = null
		for row in R.a(R.d(R.d(payload.get("live")).get("caspar")).get("generatedChannelOrder")):
			if R.s(R.d(row).get("role")) == "inputs_host":
				order_ch = row.get("ch")
				break
		var host_ch: Variant = coalesce([cm.get("inputsCh"), order_ch, cm.get("multiviewCh")])
		if host_ch != null:
			for slot in active:
				if decklink_slot_active(payload, slot):
					entries.append({"kind": "decklink", "slot": slot, "channel": host_ch, "layer": slot})
	var chans := {}
	for e in entries:
		chans[float(e.channel)] = true
	var dedicated: bool = chans.size() > 1 or not R.a(cm.get("decklinkInputChannels")).is_empty() \
		or _entries(cm).any(func(e: Dictionary) -> bool: return e.get("kind") == "decklink")
	var out := []
	if dedicated and not entries.is_empty():
		for e in entries:
			if decklink_slot_active(payload, e.slot):
				_push(out, normalize({"role": "decklink_input", "ch": e.channel, "slot": e.slot, "label": "DeckLink input %s" % R.s(e.slot)}))
	elif not entries.is_empty() or not active.is_empty():
		var host_ch: Variant = cm.get("inputsCh")
		if host_ch == null and not entries.is_empty() and entries[0].get("channel") != null:
			host_ch = entries[0].channel
		if host_ch != null:
			if not truthy(cm.get("inputsOnMvr")):
				_push(out, normalize({"role": "inputs_host", "ch": host_ch}))
			elif cm.get("multiviewCh") != null:
				_push(out, normalize({"role": "inputs_host", "ch": cm.multiviewCh, "id": "host_inputs_mvr",
					"label": "DeckLink inputs (MVR ch %s)" % R.s(cm.multiviewCh)}))
	var audio := input_channels(cm).filter(func(e: Dictionary) -> bool: return e.get("kind") == "live_audio")
	var audio_chans := {}
	for e in audio:
		audio_chans[float(e.channel)] = true
	if (audio_chans.size() > 1 or not R.a(cm.get("liveAudioInputChannels")).is_empty()) and not audio.is_empty():
		for e in audio:
			_push(out, normalize({"role": "live_audio_input", "ch": e.channel, "slot": e.get("slot"),
				"label": "Live audio input %s" % R.s(e.get("slot"))}))
	for e in input_channels(cm).filter(func(e: Dictionary) -> bool: return e.get("kind") == "v4l2"):
		_push(out, normalize({"role": "v4l2_input", "ch": e.channel, "slot": e.get("slot"),
			"label": R.s(e.label) if truthy(e.get("label")) else "USB video %s" % R.s(e.get("slot"))}))
	return out


static func _push(out: Array, d: Dictionary) -> void:
	if not d.is_empty():
		out.append(d)


## listHostLiveSourceDestinations (WO-88): webpage / NDI / browser hosts from the channel map.
static func live_source_destinations(cm: Dictionary) -> Array:
	var out := []
	for e in _entries(cm):
		var role := R.s(e.get("kind"))
		if not role in LIVE_HOST_KINDS:
			continue
		var label: Variant = e.get("label") if truthy(e.get("label")) else default_label(role, e.get("channel"), null, e.get("label"), e.get("sourceId"))
		_push(out, normalize({"hostRole": role, "casparChannel": e.get("channel"), "sourceId": e.get("sourceId"),
			"label": label, "id": destination_id(role, e.get("channel"), e.get("sourceId"))}))
	return out


## reconcileHostChannelDestination: re-number from the effective map (and relabel per-slot inputs).
static func reconcile(dest: Dictionary, cm: Dictionary) -> Dictionary:
	if dest.is_empty() or cm.is_empty():
		return dest
	var role := R.s(dest.get("hostRole")).strip_edges()
	var slot: Variant = dest.get("inputSlot")
	var has_slot: bool = (slot is int or slot is float) and slot >= 1
	var entry := {}
	if role == "decklink_input" and has_slot:
		entry = decklink_entry(cm, slot)
	elif role == "live_audio_input" and has_slot:
		entry = live_audio_entry(cm, slot)
	elif role == "v4l2_input" and has_slot:
		entry = v4l2_entry(cm, slot)
	elif role == "webpage_host" or role == "ndi_host":
		var sid := R.s(dest.get("sourceId")).strip_edges()
		for e in _entries(cm):
			if R.s(e.get("kind")) == role and (sid == "" or R.s(e.get("sourceId")) == sid):
				entry = e
				break
	var ch: Variant = entry.get("channel")
	if ch == null or _num_eq(ch, dest.get("casparChannel")):
		return dest
	var next := dest.duplicate()
	next.casparChannel = ch
	if role == "decklink_input" and slot != null:
		next.label = "DeckLink input %s (ch %s)" % [R.s(slot), R.s(ch)]
	elif role == "live_audio_input" and slot != null:
		next.label = "Live audio input %s (ch %s)" % [R.s(slot), R.s(ch)]
	elif role == "v4l2_input" and slot != null:
		var l := R.s(dest.get("label"))
		next.label = RegEx.create_from_string("\\(ch \\d+\\)").sub(l, "(ch %s)" % R.s(ch)) if l.begins_with("USB:") \
			else "USB video %s (ch %s)" % [R.s(slot), R.s(ch)]
	return next


## listHostChannelDestinations: inputs, live hosts, generatedChannelOrder, destinationIntent — first id wins.
static func host_destinations(payload: Dictionary, live_cm: Variant = null) -> Array:
	var caspar := R.d(R.d(payload.get("live")).get("caspar"))
	var from_intent := []
	for item in R.a(R.d(caspar.get("destinationIntent")).get("items")):
		var d := normalize(item)
		if not d.is_empty() and (d.hostRole != "decklink_input" or decklink_slot_active(payload, d.get("inputSlot"))):
			from_intent.append(d)
	var from_order := []
	for row in R.a(caspar.get("generatedChannelOrder")):
		if R.d(row).get("role") == "decklink_input" and not decklink_slot_active(payload, row.get("slot")):
			continue
		_push(from_order, normalize(row))
	var cm := channel_map(payload, live_cm)
	var seen := {}
	var out := []
	for list in [input_destinations(payload, cm), live_source_destinations(cm), from_order, from_intent]:
		for d in list:
			if R.s(d.get("id")) != "" and not seen.has(d.id):
				seen[d.id] = true
				out.append(reconcile(d, cm))
	return out


## listAllScreenDestinationsForDeviceView: screen destinations, pinned host channels, then auto host channels.
static func all_destinations(payload: Dictionary, live_cm: Variant = null) -> Array:
	var persisted := []
	var ids := {}
	for d in R.a(R.d(payload.get("screenDestinations")).get("destinations")):
		var id := R.s(R.d(d).get("id")).strip_edges()
		if id != "" and not ids.has(id):
			ids[id] = true
			persisted.append(d)
	var screen := persisted.filter(func(d: Dictionary) -> bool: return not is_host(d))
	var pinned := persisted.filter(func(d: Dictionary) -> bool: return is_host(d))
	var auto := host_destinations(payload, live_cm).filter(func(h: Dictionary) -> bool: return not ids.has(R.s(h.id)))
	return screen + pinned + auto


## mergeSettingsIntoDeviceViewPayload: GET /api/settings rides along as _settings + settings.casparServer/channelMap.
static func merge_settings(payload: Dictionary, settings: Variant) -> Dictionary:
	if not settings is Dictionary:
		return payload
	var out := payload.duplicate()
	var block := R.d(payload.get("settings")).duplicate()
	block.casparServer = settings.get("casparServer") if truthy(settings.get("casparServer")) else settings
	if truthy(settings.get("channelMap")):
		block.channelMap = settings.channelMap
	out._settings = settings
	out.settings = block
	return out
