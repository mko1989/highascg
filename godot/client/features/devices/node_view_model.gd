extends RefCounted
## WO-605 slice 10b — the Devices tab's Node view, pure (web device-view-caspar-render-simple.js
## renderCasparBandSimple): the rear panel as sections of node cards — GPU, DeckLink, USB video, Virtual cam, Stream,
## Record, Audio. Each card has a label, a status line and one cable dot: on the left for inputs, on the right for
## everything else. The last four sections always show, with a "+" and "None yet — click + to add." when empty.
## `slots` is devices_model.gd build().slots (GPU = gpu_layout.gd column, DeckLink in the rear order); USB video
## comes from the payload's suggested v4l2_in connectors (the classic rear panel does not list them yet).
## The web's per-card status class is left out: the node card's own border and background override it in its CSS.
## One deliberate difference: a connected GPU's line shows monitor · resolution · rate as the web's statusSubtitle
## means to — the web hands it marker items that no longer carry those fields, so it always says "Connected".

const H := preload("res://features/devices/host_channels.gd")
const O := preload("res://features/devices/output_ports_model.gd")
const R := preload("res://features/devices/cable_rules.gd")
const ORDER := ["GPU", "DeckLink", "USB video", "Virtual cam", "Stream", "Record", "Audio"]
const ADD := {"Virtual cam": "v4l2_out", "Stream": "stream_out", "Record": "record_out", "Audio": "audio_out"}
const NONE_YET := "None yet — click + to add."
## casparRearKindTitle
const KIND_TITLE := {"gpu_out": "GPU / program bus output", "decklink_out": "DeckLink program output",
	"caspar_mv_out": "Multiview channel output", "audio_out": "Audio output", "audio_in": "Audio input",
	"v4l2_in": "USB video input (V4L2)", "v4l2_out": "Virtual camera (v4l2loopback)"}
const ICON := {"gpu_out": "hdmi-port-icon", "decklink_io": "bnc_female_axis", "decklink_out": "bnc_female_axis",
	"v4l2_in": "hdmi-port-icon", "v4l2_out": "hdmi-port-icon", "stream_out": "ethernet-port-icon",
	"record_out": "record-port-icon", "audio_out": "jack-svg"}


static func _section(kind: String) -> String:
	match kind:
		"gpu_out":
			return "GPU"
		"decklink_io", "decklink_out":
			return "DeckLink"
		"v4l2_in":
			return "USB video"
		"v4l2_out":
			return "Virtual cam"
		"stream_out":
			return "Stream"
		"record_out":
			return "Record"
		"audio_out":
			return "Audio"
	return ""


static func kind_title(kind: String) -> String:
	return KIND_TITLE.get(kind, kind if kind != "" else "connector")


## [{title, add: kind | "", note: bool, nodes: [{id, label, sub, kind, dim, input, icon}]}] — `id` is the cable id
## (a GPU socket's `gpu_pN`), the key its dot registers as an anchor.
static func sections(slots: Array, payload: Dictionary) -> Array:
	var items := []
	for s in slots:
		var fallback: String = {"gpu": "gpu_out", "decklink": "decklink_io"}.get(s.kind, s.kind)
		for it in s.items:
			var n: Dictionary = it.duplicate()
			n.kind = str(it.get("kind", fallback))
			items.append(n)
		if s.kind == "decklink":  # USB video sits after DeckLink (caspar-rear-data.js)
			for c in R.a(R.d(payload.get("suggested")).get("connectors")):
				if c is Dictionary and c.get("deviceId") == "caspar_host" and c.get("kind") == "v4l2_in":
					items.append({"id": O.js(c.get("id")), "label": O.js(O.or_([c.get("label"), c.get("id")])), "kind": "v4l2_in"})
	var live := R.d(payload.get("live"))
	var out := []
	for title in ORDER:
		var nodes := []
		for it in items:
			if O.js(it.get("id")) == "" or H.truthy(it.get("hidden")) or _section(it.kind) != title:
				continue
			var id := R.gpu_port_cable_id(O.js(O.or_([it.get("layoutSlotId"), it.id]))) if it.kind == "gpu_out" else O.js(it.id)
			if id == "":
				continue
			var label := RegEx.create_from_string("<[^>]+>").sub(O.js(O.or_([it.get("labelHtml"), it.get("label"), id])), "", true)
			nodes.append({"id": id, "label": label, "sub": subtitle(it, live), "kind": it.kind, "icon": O.js(it.icon).get_file().get_basename() if H.truthy(it.get("icon")) else ICON.get(it.kind, "bnc_female_axis"),
				"dim": H.truthy(it.get("isVirtual")) or (it.kind == "gpu_out" and not H.truthy(it.get("connected"))),
				"input": _input(it.kind, O.js(it.id), payload)})
		if nodes.is_empty() and not ADD.has(title):
			continue
		out.append({"title": title, "add": ADD.get(title, ""), "note": nodes.is_empty(), "nodes": nodes})
	return out


static func _input(kind: String, id: String, payload: Dictionary) -> bool:
	if kind == "decklink_io":
		var c := R.connector_by_id(payload, id)
		return not c.is_empty() and R.decklink_direction(c) == "in"
	return kind in ["audio_in", "v4l2_in"]


## statusSubtitle: the GPU's monitor · resolution · rate, a DeckLink output's mode or fault, stream / record /
## virtual cam activity, else the kind's title.
static func subtitle(it: Dictionary, live: Dictionary) -> String:
	var kind: String = it.kind
	if kind == "gpu_out":
		if H.truthy(it.get("connected")):
			var parts := []
			for v in [it.get("monitor"), it.get("resolution")]:
				if H.truthy(v):
					parts.append(O.js(v))
			var hz: Variant = it.get("refreshHz")
			if (hz is float or hz is int) and is_finite(float(hz)):
				parts.append("%s Hz" % O.js(hz))
			return " · ".join(parts) if not parts.is_empty() else "Connected"
		return "Present, not connected" if H.truthy(it.get("livePresent")) else "Disconnected"
	var outs: Variant = R.d(live.get("decklink")).get("outputs")
	if kind in ["decklink_out", "decklink_io"] and H.truthy(outs):
		var st := {}
		for o in R.a(outs):
			if O.js(R.d(o).get("connectorId")) == O.js(it.id):
				st = o
				break
		if not st.is_empty() and not H.truthy(st.get("ok")):
			return O.js(O.or_([st.get("reason"), "Invalid output"]))
		var inh := R.d(st.get("inherited"))
		if H.truthy(inh.get("standardModeId")):
			return "%s (%s×%s)" % [O.js(inh.standardModeId), O.js(inh.get("width")), O.js(inh.get("height"))]
	match kind:
		"stream_out", "record_out":
			var key := "streaming" if kind == "stream_out" else "recording"
			var on := R.a(R.d(live.get(key)).get("activeOutputs")).any(func(x: Variant) -> bool: return O.js(x) == O.js(it.id))
			return ("Streaming" if on else "Idle") if kind == "stream_out" else ("Recording" if on else "Idle")
		"v4l2_out":
			return "Live" if H.truthy(R.d(live.get("virtualCamera")).get("running")) else "Idle"
	return kind_title(kind)
