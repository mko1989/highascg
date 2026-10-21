extends RefCounted
## WO-600 M — the multiview editor document (web client/lib/multiview-state.js minus storage): load a stored
## layout (project.multiview / a preset slot) into editor state, export the project slice, preset snapshots and the
## label a cell shows. Pure — multiview_tab.gd owns where it is stored.

const G := preload("res://features/multiview/mv_geometry.gd")
const L := preload("res://features/multiview/mv_layout.gd")
const EXPORT_KEYS := ["cells", "canvasWidth", "canvasHeight", "showOverlay", "bgColor", "showTimersUnderLabels", "timerScale",
	"highlightTopTimer", "autoApply"]
const LABEL_MAX := 36


static func empty() -> Dictionary:
	return {"cells": [], "canvasWidth": L.DEFAULT_W, "canvasHeight": L.DEFAULT_H, "showOverlay": true, "bgColor": "#000000",
		"showTimersUnderLabels": false, "timerScale": 100.0, "highlightTopTimer": true, "autoApply": true, "audioActiveCellId": null}


## web loadFromData / applyPresetSnapshot — null when `data` holds no cell array (keep the current state then).
static func load(data: Variant, cm: Dictionary, base: Dictionary = {}) -> Variant:
	if not (data is Dictionary) or not (data.get("cells") is Array):
		return null
	var b := base if not base.is_empty() else empty()
	var cw: Variant = data.get("canvasWidth")
	var ch: Variant = data.get("canvasHeight")
	var bg: Variant = data.get("bgColor")
	var aud: Variant = data.get("audioActiveCellId")
	return {"cells": L.migrate_preview_route_sources((data.cells as Array).duplicate(true), cm),
		"canvasWidth": float(cw) if cw != null else float(b.canvasWidth), "canvasHeight": float(ch) if ch != null else float(b.canvasHeight),
		"showOverlay": data.get("showOverlay") != false, "bgColor": str(bg) if bg else str(b.bgColor),
		"showTimersUnderLabels": bool(data.get("showTimersUnderLabels", false)), "timerScale": L.timer_scale(data.get("timerScale")),
		"highlightTopTimer": data.get("highlightTopTimer") != false, "autoApply": data.get("autoApply") != false,
		"audioActiveCellId": aud if aud else null}


## web getExportData — the project.multiview slice (no audio focus: that is per-session, like the web).
static func export(st: Dictionary) -> Dictionary:
	var o := {}
	for k in EXPORT_KEYS:
		o[k] = st[k].duplicate(true) if st[k] is Array else st[k]
	return o


## web snapshotForPreset — export + the audio-focused cell.
static func snapshot(st: Dictionary) -> Dictionary:
	var o := export(st)
	o.audioActiveCellId = st.get("audioActiveCellId")
	return o


## Preset slots are always 4 entries, null = never saved (web getPresetSlots).
static func slots(v: Variant) -> Array:
	return (v as Array).duplicate(true) if v is Array and v.size() == 4 else [null, null, null, null]


## The label a cell's strip shows (web drawMultiviewEditor): source label / value / cell label / id, a virtual main's
## name for PGM/PRV cells, the screen resolution suffix, cut to 36 chars.
static func cell_label(c: Dictionary, cm: Dictionary) -> String:
	var s: Variant = c.get("source")
	var base: Variant = ((s.get("label") if s.get("label") else s.get("value")) if s is Dictionary else null) if s else c.get("label")
	if not base:
		base = c.get("id", "")
	var ov: Variant = G.overlay_type(c, cm)
	var si: Variant = c.get("screenIdx")
	if (ov == "pgm" or ov == "prv") and (si is int or si is float):
		var vm: Variant = G._at(cm.get("virtualMainChannels"), int(si))
		if vm is Dictionary and vm.get("name"):
			base = "%s · %s" % ["PGM" if ov == "pgm" else "PRV", vm.name]
	var text := str(base) + G.resolution_suffix(c, cm)
	return text.substr(0, LABEL_MAX - 3) + "…" if text.length() > LABEL_MAX else text


## WO-156: a route of the multiview's own channel would wedge it — the refusal text, or "" when allowed.
static func self_route_message(value: Variant, mv_ch: Variant) -> String:
	var p: Variant = G.parse_route(value)
	if p == null or mv_ch == null or int(p.channel) != int(mv_ch):
		return ""
	return "Cannot show route://%d on this multiview — channel %d is the multiview's own output and routing it into itself would freeze it." % [p.channel, int(mv_ch)]


static func mv_channels(cm: Dictionary) -> Array:
	if cm.get("multiviewChannels") is Array:
		return cm.multiviewChannels
	return [cm.multiviewCh] if cm.get("multiviewCh") != null else []


## web syncMultiviewCanvasFromChannelMap — the multiview channel's resolution, else screen 1's; ZERO = unknown.
static func canvas_size(cm: Dictionary) -> Vector2:
	var by: Variant = cm.get("channelResolutionsByChannel")
	var mv: Variant = cm.get("multiviewCh")
	var r: Variant = by.get(str(int(mv))) if by is Dictionary and mv != null else null
	if not (r is Dictionary):
		r = G._at(cm.get("programResolutions"), 0)
	if r is Dictionary and float(r.get("w", 0)) > 0 and float(r.get("h", 0)) > 0:
		return Vector2(float(r.w), float(r.h))
	return Vector2.ZERO
