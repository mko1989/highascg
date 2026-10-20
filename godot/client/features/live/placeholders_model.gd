extends RefCounted
## WO-603 parity row 26 — Sources "Placeholders" tab (web client/lib/placeholder-state.js, placeholder-modal.js,
## components/sources-panel-placeholders.js): virtual media for offline / preshow mode. The list is the project's
## `placeholders` slice (the web mirrored it to localStorage and exported it into the project; here the project is
## the only copy). Pure — the panel is placeholders_panel.gd.

const TEMPLATES := [
	{"id": "color_grid", "label": "Color Grid", "description": "Multi-color test grid with 10% steps"},
	{"id": "smpte_bars", "label": "SMPTE Bars", "description": "Standard SMPTE color bars"},
	{"id": "aspect_guide", "label": "Aspect Ratio Guide", "description": "16:9, 4:3, and 2.35:1 framing guides"},
	{"id": "countdown", "label": "Countdown", "description": "Circular 10s visual countdown"},
	{"id": "white_noise", "label": "White Noise", "description": "Animated static"},
	{"id": "solid", "label": "Solid Color", "description": "Constant color fill"},
]
const RESOLUTIONS := [
	["1080p5000", "1080p50"], ["1080p6000", "1080p60"], ["2160p5000", "4K 50p"], ["2160p6000", "4K 60p"],
	["720p5000", "720p50"],
]
const DEFAULT_COLOR := "#3b82f6"


## Web shows the tab (and "Add Placeholder…") only while the server runs in offline mode.
static func tab_visible(offline: bool, forced := false) -> bool:
	return offline or forced


static func base36(n: int) -> String:
	const DIGITS := "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	if n <= 0:
		return "0"
	var s := ""
	while n > 0:
		s = DIGITS[n % 36] + s
		n /= 36
	return s


## PlaceholderState.add(): id PLC_<TEMPLATE>_<base36 ms>, defaults color_grid / 1080p5000 / 60 s.
static func make(p: Dictionary, now_ms: int) -> Dictionary:
	var template := str(p.get("template", "")) if str(p.get("template", "")) != "" else "color_grid"
	var id := "PLC_%s_%s" % [template.to_upper(), base36(now_ms)]
	var label := str(p.get("label", "")).strip_edges()
	var item := {
		"id": id,
		"label": label if label != "" else id,
		"template": template,
		"resolution": str(p.get("resolution", "")) if str(p.get("resolution", "")) != "" else "1080p5000",
		"durationMs": int(p.get("durationMs", 0)) if int(p.get("durationMs", 0)) > 0 else 60000,
		"isPlaceholder": true,
		"isDir": false,
	}
	if template == "solid":
		item["value"] = str(p.get("value", DEFAULT_COLOR))
	return item


static func list_of(project: Dictionary) -> Array:
	var v: Variant = project.get("placeholders")
	return (v as Array).filter(func(x: Variant) -> bool: return x is Dictionary and str((x as Dictionary).get("id", "")) != "") if v is Array else []


static func without(list: Array, id: String) -> Array:
	return list.filter(func(x: Variant) -> bool: return str((x as Dictionary).get("id", "")) != id)


## Same payload as the web makeDraggable(el, 'media', id, label, extra) — the extra spreads last, so a solid
## placeholder's colour replaces `value` (it lands as a colour source, which Caspar can play).
static func payload(item: Dictionary) -> Dictionary:
	var p := {
		"type": "media", "value": str(item.id), "label": str(item.get("label", item.id)), "isPlaceholder": true,
		"template": str(item.get("template", "")), "resolution": str(item.get("resolution", "")),
		"durationMs": int(item.get("durationMs", 0)),
	}
	if item.has("value"):
		p["value"] = str(item.value)
	return p


static func template_label(id: String) -> String:
	for t in TEMPLATES:
		if t.id == id:
			return str(t.label)
	return id


## source_list_panel.gd rows: [TEMPLATE pill | label  resolution · 1:00].
static func rows(list: Array, filter: String) -> Array:
	var out: Array = []
	var f := filter.strip_edges().to_lower()
	for item in list:
		var label := str(item.get("label", item.id))
		if f != "" and not label.to_lower().contains(f):
			continue
		var secs := int(item.get("durationMs", 0)) / 1000
		var dur := "%d:%02d" % [secs / 60, secs % 60]
		out.append({
			"pill": "PH", "kind": "placeholder", "payload": payload(item),
			"text": "%s   %s · %s" % [label, str(item.get("resolution", "")), dur],
			"tip": "%s placeholder%s — drag onto a look; right-click to remove" % [template_label(str(item.get("template", ""))),
				(" " + str(item.value)) if item.has("value") else ""],
		})
	return out
