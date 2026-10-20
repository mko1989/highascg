extends RefCounted
## WO-605 slice 11 — the pure half of the "Add live input" dialog (web live-input-modal.js, -shell.js, -submit.js,
## live-audio-add-input.js / v4l2-add-input.js slot picking, v4l2-inputs.js pickers): type list, the HTML hints
## (shown through bbcode()), the SDI port list + host-channel row, NDI / ALSA / V4L2 pickers, the slot hints, and
## each type's validation + addExtraLiveSource item + status text. live_input_flow.gd runs the requests.
## Golden-tested in tests/test_devices_live_input.gd.

const R := preload("res://features/devices/cable_rules.gd")
const H := preload("res://features/devices/host_channels.gd")
const HS := preload("res://features/devices/host_source_model.gd")
const IS := preload("res://features/devices/input_slots_model.gd")

const KINDS := [["decklink", "Decklink"], ["ndi", "NDI"], ["browser_display", "Web Browser (system)"],
	["browser", "Web Browser (CG template)"], ["live_audio", "Live Audio"], ["usb_video", "USB Video (V4L2)"]]
const WRAP := {"decklink": "decklink", "ndi": "ndi", "browser_display": "browser-display", "browser": "browser",
	"live_audio": "live-audio", "usb_video": "v4l2"}
const V4L2_FORMATS := ["auto", "mjpeg", "yuyv422"]
const APPLY_MSG := " Apply Caspar config and restart in Device View to start capture."
const TEMPLATE_BASE := "http://127.0.0.1:4200/template/"
const MAX_MSG := {"live_audio": "Maximum 8 live audio inputs — remove one in Settings or Audio Mixer",
	"usb_video": "Maximum 8 USB video inputs — remove one from its input tile in the device view"}
const BD_NOTE := "Browser runs off-screen; max size = free desktop area (1920x648 on this box). Create, then use the Inspector to toggle operator screen."
const CG_TEXT := "Add as CG template (plays highascg_browser_url + passes URL via CG UPDATE)"

const HINTS := {
	"decklink_new": "Registers a <strong>dedicated Caspar host channel</strong> for this SDI port and adds a Live source tile. HighAsCG updates DeckLink input count in config — use <strong>Apply Caspar config</strong> in Device View when you are ready to restart and start capture.",
	"ndi": "NDI plays on a <strong>dedicated host channel</strong> (allocated automatically). Drag the tile from Sources → Live onto PGM, preview, or multiview using <code>route://</code> — do not play NDI directly on program layers.",
	"live_audio": "Live audio gets a <strong>dedicated Caspar host channel</strong> (cheapest video mode, audio-only — no video consumers). ALSA capture runs once on that channel; drag <code>route://</code> from Sources → Live onto PGM or multiview for on-air.",
	"usb_video": "USB / V4L2 video gets a <strong>dedicated Caspar host channel</strong>. FFmpeg captures from the device and Caspar plays MPEG-TS via UDP; drag <code>route://</code> from Sources → Live onto PGM or multiview. Apply Caspar config when adding a new slot.",
	"browser_display": "Browser runs on a <strong>dedicated host channel</strong> (real Firefox + x11grab capture, not CEF). Drag <code>route://</code> from Sources → Live onto PGM or multiview for on-air. Use the Inspector to toggle between background and operator monitor, and to change URL/dimensions. Apply Caspar config after adding.",
	"browser_cg": "CG mode: program/preview use a short <strong>highascg_browser_url</strong> template on Caspar (synced from HighAsCG <code>template/</code>) with your URL in CG data — not a persistent host channel.",
	"browser": "Webpage plays on a <strong>dedicated host channel</strong> with <code>LOOP</code> so state survives when taken off air. Apply Caspar config after adding, then drag <code>route://</code> onto PGM or multiview.",
}


static func escape_html(s: Variant) -> String:
	return HS._str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")


## The hint HTML as RichTextLabel BBCode (<strong> → bold, <code> → mono, entities back to text).
static func bbcode(html: String) -> String:
	var t := html.replace("[", "[lb]").replace("<strong>", "[b]").replace("</strong>", "[/b]") \
		.replace("<code>", "[code]").replace("</code>", "[/code]")
	return t.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&")


## effectiveChannelMap({settings, liveChannelMap: state.channelMap}).
static func channel_map(settings: Variant, state: Dictionary) -> Dictionary:
	return H.channel_map({"_settings": R.d(settings)}, state.get("channelMap"))


## syncHint for kind `k`; `entry` = the selected SDI port's decklinkInputForSlot.
static func hint(k: String, slot: int, entry: Dictionary, as_cg: bool) -> String:
	match k:
		"decklink":
			if entry.get("channel") == null:
				return HINTS.decklink_new
			return ("DeckLink slot <strong>%d</strong> plays on dedicated channel <strong>%s</strong> (layer %s). Drag <strong>%s</strong> from Sources → Live — do not start a second <code>DECKLINK</code> producer for the same device."
				% [slot, R.s(entry.channel), R.s(H.coalesce([entry.get("layer"), slot])),
					escape_html(entry.label if H.truthy(entry.get("label")) else "DeckLink %d" % slot)])
		"browser":
			return HINTS.browser_cg if as_cg else HINTS.browser
	return HINTS.get(k, "")


## syncDecklinkHostChannelHint → [value, note].
static func decklink_channel(entry: Dictionary, config_comparison: Variant) -> Array:
	var ch: Variant = entry.get("channel")
	if ch == null:
		return ["—", "(Apply Caspar config to allocate)"]
	return [R.s(ch), "(planned — Apply Caspar config to activate)" if H.channel_planned(ch, config_comparison)
		else "— drag the route tile from Sources → Live onto PGM, preview, or multiview."]


## refreshDecklinkPorts over GET /api/device-view: {ports: [[value, label]…], status}.
static func decklink_ports(dv: Dictionary) -> Dictionary:
	var seen := {}
	var list := []
	for c in R.a(R.d(dv.get("graph")).get("connectors")) + R.a(R.d(dv.get("suggested")).get("connectors")):
		if not c is Dictionary or c.get("kind") != "decklink_io":
			continue
		var slot := H._connector_slot(c)
		if seen.has(slot):
			continue
		seen[slot] = true
		list.append(c)
	list.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return H._connector_slot(a) < H._connector_slot(b))
	if list.is_empty():
		return {"ports": [["1", "SDI 1"], ["2", "SDI 2"], ["3", "SDI 3"], ["4", "SDI 4"]],
			"status": "No DeckLink detected — pick a port number."}
	var ports := []
	for c in list:
		var slot := H._connector_slot(c)
		var dir := H._io_direction(c.get("caspar"))
		ports.append([str(slot), "%s%s" % [c.label if H.truthy(c.get("label")) else "SDI %d" % slot,
			" · input" if dir == "in" else (" · output" if dir == "out" else "")]])
	return {"ports": ports, "status": "%d port(s) from Device View" % list.size()}


static func ndi_label(name: String) -> String:
	if not name.begins_with("ndi://"):
		return name
	return RegEx.create_from_string("/\"([^\"]+)\"").sub(name.substr(6), " $1")


## Discover NDI sources: GET /api/ndi/list reply → {options, status}.
static func ndi_list(r: Variant) -> Dictionary:
	var d := R.d(r)
	var sources := R.a(d.get("sources"))
	if sources.is_empty():
		return {"options": [["", HS._str(d.error) if H.truthy(d.get("error")) else "No sources (install NDI-enabled FFmpeg on server)"]], "status": ""}
	return {"options": sources.map(func(n: Variant) -> Array: return [HS._str(n), ndi_label(HS._str(n))]),
		"status": "%d source(s)" % sources.size()}


## pickLiveAudioSlotForDevice / pickV4l2SlotForDevice: {slot, count, slots} or {error}.
static func pick_slot(k: String, ui: Dictionary, device: String) -> Dictionary:
	var dev := device.strip_edges()
	if dev == "":
		return {"error": "Select a capture device"}
	for i in range(1, ui.count + 1):
		if str(ui.slots[i - 1]).strip_edges() == "":
			return {"slot": i, "count": ui.count, "slots": ui.slots.duplicate()}
	if ui.count >= IS.MAX_SLOTS:
		return {"error": MAX_MSG[k]}
	var slots: Array = ui.slots.duplicate()
	slots[ui.count] = dev
	return {"slot": ui.count + 1, "count": ui.count + 1, "slots": slots}


static func read_ui(k: String, settings: Variant) -> Dictionary:
	var cs: Variant = R.d(settings).get("casparServer")
	return IS.read_live_audio(cs) if k == "live_audio" else IS.read_v4l2(cs)


## syncLiveAudioSlotHint / syncV4l2SlotHint (`cm` = the channel map the dialog opened with).
static func slot_hint(k: String, settings: Variant, device: String, cm: Dictionary) -> String:
	var p := pick_slot(k, read_ui(k, settings), device if device != "" else ("alsa://placeholder" if k == "live_audio" else "/dev/video0"))
	if p.has("error"):
		return p.error
	var entry := H.live_audio_entry(cm, p.slot) if k == "live_audio" else H.v4l2_entry(cm, p.slot)
	if entry.get("channel") == null:
		return "Will use slot %d. Apply Caspar config if this is a new channel." % p.slot
	return "Will use slot %d on host ch %s (%s)." % [p.slot, R.s(entry.channel), entry.route if H.truthy(entry.get("route")) else "route://…"]


## v4l2CaptureDeviceOptions → [[value, label, disabled]…]
static func v4l2_options(devices: Variant) -> Array:
	var out := [["", "(none)", false]]
	for d in R.a(devices):
		if not d is Dictionary or not H.truthy(d.get("path")):
			continue
		var excluded := H.truthy(d.get("excludedReason")) or not H.truthy(d.get("captureCapable"))
		var name := HS._str(d.name if H.truthy(d.get("name")) else d.path)
		out.append([HS._str(d.stableId if H.truthy(d.get("stableId")) else d.path),
			"%s — %s" % [name, HS._str(d.excludedReason) if H.truthy(d.get("excludedReason")) else "not capture"] if excluded
			else "%s (%s)" % [name, HS._str(d.path)], excluded])
	return out


## v4l2AlsaDeviceOptions → [[value, label]…] (alsa:// stripped, `none` first).
static func v4l2_alsa_options(devices: Variant) -> Array:
	var out := [["none", "none (video only)"]]
	var seen := {"none": true}
	var strip := RegEx.create_from_string("(?i)^alsa://")
	for d in R.a(devices):
		if not d is Dictionary or d.get("type") != "alsa":
			continue
		var id := HS._str(d.get("id")).strip_edges()
		if id == "" or seen.has(id):
			continue
		seen[id] = true
		var name := (HS._str(d.name) if H.truthy(d.get("name")) else id).strip_edges()
		var hw := strip.sub(id, "")
		out.append([hw, hw if name == id else "%s (%s)" % [name, hw]])
	return out


# ---------------------------------------------------------------- submit

## NDI: {item} or {error}; the typed name wins over the picked one.
static func ndi_item(manual: String, picked: String) -> Dictionary:
	var name := manual.strip_edges()
	if name == "":
		name = picked.strip_edges()
	if name == "":
		return {"error": "Pick a discovered source or enter a name"}
	return {"item": {"type": "ndi", "ndiName": name, "label": ndi_label(name)}}


static func browser_display_item(url_text: String, w: String, h: String, f: String) -> Dictionary:
	var url := url_text.strip_edges()
	if url == "":
		return {"error": "Enter a URL"}
	return {"item": {"mode": "browser_display", "url": url, "width": maxi(160, HS._int_or(w, 1152)),
		"height": maxi(120, HS._int_or(h, 648)), "fps": maxi(1, mini(60, HS._int_or(f, 25))), "label": url}}


static func browser_item(use_template: bool, template: String, url_text: String, as_cg: bool) -> Dictionary:
	var url := ""
	if use_template:
		var name := template.strip_edges()
		if name == "":
			return {"error": "Select a template"}
		url = TEMPLATE_BASE + (name.left(-5) if name.ends_with(".html") else name) + ".html"
	else:
		url = url_text.strip_edges()
		if url == "":
			return {"error": "Enter a URL or select a template"}
	var item := {"type": "browser", "value": url, "label": url + " (CG)" if as_cg else url, "templateOrUrl": url}
	if as_cg:
		item.browserAsCg = true
	return {"item": item}


static func _host_msg(play: Variant, ok_text: String) -> String:
	var p := R.d(play)
	if H.truthy(p.get("ok")):
		return ok_text
	return " Host PLAY: " + HS._str(p.error) if H.truthy(p.get("error")) else ""


## addExtraLiveSource reply → [status, restart-dirty] (browser CG adds never ask for a restart).
static func added_message(r: Variant, as_cg := false) -> Array:
	var d := R.d(r)
	var restart := not as_cg and (H.truthy(d.get("pendingApply")) or H.truthy(d.get("casparRestartRecommended")))
	return ["Added to Live Sources.%s%s" % [_host_msg(d.get("hostLivePlay"), " Host producer started."), APPLY_MSG if restart else ""], restart]


## Live audio / USB video slot add result {slot, host_channel, restart, play} → status.
static func slot_message(k: String, res: Dictionary) -> String:
	var p := R.d(res.get("play"))
	var host := ""
	if H.truthy(p.get("ok")):
		host = " Capture started on ch %s." % ("?" if res.host_channel == null else R.s(res.host_channel))
	elif H.truthy(p.get("error")):
		host = " Capture: " + HS._str(p.error)
	return "%s slot %d added.%s%s" % ["Live audio" if k == "live_audio" else "USB video", res.slot, host, APPLY_MSG if res.restart else ""]


static func decklink_message(slot: int, fin: Dictionary) -> String:
	var ch: Variant = fin.host_channel
	return "DeckLink input slot %d . %s . %s.%s%s" % [slot, "host channel (after apply)" if ch == null else "host channel " + R.s(ch),
		fin.route, APPLY_MSG if fin.restart or fin.pending else "", " (capture refreshed on existing host channel.)" if fin.get("already", false) else ""]


# ---------------------------------------------------------------- the Devices "Add live input" band

const BAND_HOSTS_NOTE := "Configured live inputs appear above as host channel destinations — use the output dot on the right to cable to Record, Stream, or other outputs."
const BAND_EMPTY_NOTE := "No live inputs yet. Click + to add DeckLink, NDI, USB video, or live audio."
const HOST_KINDS := ["webpage_host", "ndi_host", "browser_display"]


## hostDestinationIdForExtraLiveSource ("" = none).
static func extra_host_id(x: Dictionary) -> String:
	var rt := HS._str(x.get("routeType")).to_lower()
	var n: Variant = H.js_int(H.coalesce([x.get("inputsChannel"), x.get("hostChannel"), ""]))
	var ch: Variant = n if n != null else 1
	for spec in [["decklink", "decklinkSlot", "decklink_input"], ["live_audio", "liveAudioSlot", "live_audio_input"],
			["v4l2", "v4l2Slot", "v4l2_input"]]:
		if rt == spec[0] and x.get(spec[1]) != null:
			return H.destination_id(spec[2], ch, x[spec[1]])
	if rt in HOST_KINDS:
		var sid := HS._str(H.coalesce([HS._truthy_or_null(x.get("sourceId")), HS._truthy_or_null(x.get("hostSourceId")), ""])).strip_edges()
		return H.destination_id(rt, ch, sid if sid != "" else null)
	return ""


## reconcileExtraLiveSourceChannel: take the channel / layer / route from the effective map.
static func reconcile_extra(x: Dictionary, cm: Dictionary) -> Dictionary:
	if cm.is_empty():
		return x
	var rt := HS._str(x.get("routeType")).to_lower()
	var entry := {}
	if rt == "decklink" and x.get("decklinkSlot") != null:
		entry = H.decklink_entry(cm, x.decklinkSlot)
	elif rt == "live_audio" and x.get("liveAudioSlot") != null:
		entry = H.live_audio_entry(cm, x.liveAudioSlot)
	elif rt == "v4l2" and x.get("v4l2Slot") != null:
		entry = H.v4l2_entry(cm, x.v4l2Slot)
	elif rt in HOST_KINDS:
		var sid := HS._str(H.coalesce([HS._truthy_or_null(x.get("sourceId")), HS._truthy_or_null(x.get("hostSourceId")), ""])).strip_edges()
		for e in R.a(cm.get("inputChannels")):
			if HS._str(R.d(e).get("kind")) == rt and (sid == "" or HS._str(e.get("sourceId")) == sid):
				entry = e
				break
	if entry.get("channel") == null:
		return x
	var out := x.duplicate()
	out.inputsChannel = entry.channel
	out.hostChannel = entry.channel
	out.inputsLayer = H.coalesce([entry.get("layer"), x.get("inputsLayer")])
	var route: Variant = entry.route if H.truthy(entry.get("route")) else x.get("value")
	out.value = route if H.truthy(route) else x.get("value")
	return out


## detailForExtra: the band row's second line.
static func extra_detail(x: Dictionary, cm: Dictionary) -> String:
	var row := reconcile_extra(x, cm)
	var rt := HS._str(row.get("routeType")).to_lower()
	var type := HS._str(row.get("type")).to_lower()
	if rt == "decklink" or row.get("decklinkSlot") != null:
		var parts := []
		if row.get("inputsChannel") != null:
			parts.append("ch " + R.s(row.inputsChannel))
		if row.get("decklinkDevice") != null:
			parts.append("device " + R.s(row.decklinkDevice))
		return " · ".join(parts) if not parts.is_empty() else "DeckLink"
	if type == "ndi" or rt == "ndi_host":
		return "NDI"
	if type == "browser" and rt != "browser_display":
		return "Webpage"
	var by_route := {"browser_display": "Browser (system)", "webpage_host": "Webpage", "live_audio": "Live audio", "v4l2": "USB video"}
	if by_route.has(rt):
		return by_route[rt]
	if type == "route" and H.truthy(row.get("value")):
		return HS._str(row.value)
	return type if type != "" else "Live source"


static func _deck_connector(payload: Dictionary, slot: float) -> String:
	for c in R.a(R.d(payload.get("graph")).get("connectors")) + R.a(R.d(payload.get("suggested")).get("connectors")):
		if c is Dictionary and c.get("kind") == "decklink_io" and float(H._connector_slot(c)) == slot:
			return HS._str(c.get("id"))
	return ""


## collectUnlistedLiveSourceRows: live sources with no host-channel card above → [{label, detail, connectorId, portKey}]
## (connectorId "" = not selectable).
static func band_rows(payload: Dictionary, live_cm: Variant = null) -> Array:
	var host_ids := {}
	for d in H.host_destinations(payload, live_cm):
		host_ids[R.s(d.id)] = true
	var cm := H.channel_map(payload, live_cm)
	var suggested := R.a(R.d(payload.get("suggested")).get("connectors"))
	var extra := R.a(payload.get("extraLiveSources")).filter(func(x: Variant) -> bool: return x is Dictionary)
	var rows := []
	var deck_shown := {}
	for x in extra:
		var host_id := extra_host_id(x)
		if host_id != "" and host_ids.has(host_id):
			var slot: Variant = H.js_int(H.coalesce([x.get("decklinkSlot"), ""]))
			if slot != null and slot >= 1:
				deck_shown[slot] = true
			continue
		var label := HS._str(H.coalesce([HS._truthy_or_null(x.get("label")), HS._truthy_or_null(x.get("ndiName")),
			HS._truthy_or_null(x.get("value")), "Live source"]))
		var cid := HS._str(x.get("connectorId")).strip_edges()
		if cid == "" and x.get("decklinkSlot") != null:
			cid = _deck_connector(payload, HS._num(x.decklinkSlot))
		rows.append({"label": label, "detail": extra_detail(x, cm), "connectorId": cid,
			"portKey": "conn:" + cid if cid != "" else "live_extra:" + (HS._str(x.value) if H.truthy(x.get("value")) else label)})
	for c in suggested:
		if not c is Dictionary or c.get("deviceId") != "caspar_host" or c.get("kind") != "v4l2_in":
			continue
		var slot: Variant = H.js_int(H.coalesce([c.get("index"), ""]))
		if slot != null and slot >= 0 and host_ids.has(H.destination_id("v4l2_input", 1, slot + 1)):
			continue
		var cid := HS._str(c.get("id"))
		rows.append({"label": HS._str(H.coalesce([HS._truthy_or_null(c.get("label")), HS._truthy_or_null(c.get("externalRef")), c.get("id")])),
			"detail": HS._str(c.externalRef) if H.truthy(c.get("externalRef")) else "USB video", "connectorId": cid,
			"portKey": "conn:" + cid if cid != "" else null})
	for i in R.a(R.d(R.d(payload.get("live")).get("decklink")).get("inputs")):
		var row := R.d(i)
		var slot := int(HS._num(row.get("slot"))) if not is_nan(HS._num(row.get("slot"))) else 0
		var hc := HS._num(row.get("hostChannel"))
		if slot <= 0 or deck_shown.has(slot) or host_ids.has(H.destination_id("decklink_input", int(hc) if not is_nan(hc) and hc != 0 else 1, slot)):
			continue
		var io := {}
		for c in suggested:
			if c is Dictionary and c.get("kind") == "decklink_io" and H._connector_slot(c) == slot:
				io = c
				break
		if not (H._io_direction(io.get("caspar")) == "in" if not io.is_empty() else HS._str(row.get("ioDirection")).to_lower() == "in"):
			continue
		var cid := _deck_connector(payload, slot)
		rows.append({"label": "DeckLink input %d" % slot, "detail": "device %s" % R.s(H.coalesce([HS._truthy_or_null(row.get("resolvedDevice")),
			HS._truthy_or_null(row.get("device")), "?"])), "connectorId": cid, "portKey": "conn:" + cid if cid != "" else "decklink_slot:%d" % slot})
	return rows
