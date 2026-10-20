extends RefCounted
## WO-623 C — Sources Templates / Timelines rows behave like the web (sources-panel-templates.js renderTemplatesBrowser,
## renderSourceList 'timeline'). TLS ids below are the box's real shape (uppercase, Caspar TLS) from 2026-10-20.

const M := preload("res://features/live/source_lists_model.gd")
var t

const TLS := [
	{"id": "BLACK", "label": "BLACK"},
	{"id": "COUNTDOWN/COUNTDOWN", "label": "COUNTDOWN/COUNTDOWN"},
	{"id": "SHADERS/SH-3D-METERS-C2", "label": "SHADERS/SH-3D-METERS-C2"},
	{"id": "SHADERS/SH-UNNAMED", "label": "SHADERS/SH-UNNAMED"},
	{"id": "LOWER-THIRDS/LT-NAME", "label": "LOWER-THIRDS/LT-NAME"},
	{"id": "WIN\\SHADERS\\SH-BALATRO"},
	{"label": "ONLY_LABEL"},
	{},
	"junk",
]
const SHADERS := {"shaders": [{"id": "sh-3d-meters-c2", "name": "mirrors c2"}, {"id": "sh-balatro", "name": null}, {"name": "no id"}]}


func test_shader_names() -> void:
	t.eq(M.shader_names(SHADERS), {"sh-3d-meters-c2": "mirrors c2", "sh-balatro": "sh-balatro"}, "lowercased id → name (id when unnamed)")
	t.eq(M.shader_names(null), {}, "request failed")


func test_template_rows() -> void:
	var rows := M.template_rows(TLS, M.shader_names(SHADERS))
	t.eq(rows.map(func(r: Dictionary) -> String: return "%s|%s|%s" % [r.pill, r.kind, r.text]), [
		"FT|template|BLACK",
		"FT|template|COUNTDOWN/COUNTDOWN",
		"FX|shader|mirrors c2",  # owner bug 27.07.26: the library name, not the TLS id
		"FX|shader|SHADERS/SH-UNNAMED",  # not in the library → the TLS label
		"FT|cg|LOWER-THIRDS/LT-NAME",
		"FX|shader|sh-balatro",  # backslashes normalised before matching
		"FT|template|ONLY_LABEL",
	], "pills / kinds / shown text")
	t.eq(rows[2].payload, {"type": "template", "value": "SHADERS/SH-3D-METERS-C2", "label": "SHADERS/SH-3D-METERS-C2"},
		"drag label stays the raw TLS label (web makeDraggable(el, 'template', id, label))")
	t.eq(rows[5].payload, {"type": "template", "value": "WIN\\SHADERS\\SH-BALATRO", "label": "WIN\\SHADERS\\SH-BALATRO"}, "label falls back to id")
	t.eq(rows[6].payload.value, "ONLY_LABEL", "id falls back to label")


func test_template_filter() -> void:
	var names := M.shader_names(SHADERS)
	t.eq(M.template_rows(TLS, names, "  count ").map(func(r: Dictionary) -> String: return r.text), ["COUNTDOWN/COUNTDOWN"], "case-insensitive, trimmed")
	t.eq(M.template_rows(TLS, names, "mirrors").size(), 0, "web filters on the TLS label, not the shader display name")
	t.eq(M.template_rows(TLS, names, "sh-3d").size(), 1, "TLS label matches")
	t.eq(M.template_rows([], names), [], "empty catalogue")
	t.eq(M.template_rows(null, names), [], "failed request")


func test_timeline_rows() -> void:
	var tls := [
		{"id": "tmve1ppeug1t", "name": "Timeline", "duration": 60000, "layers": [{}, {}]},
		{"id": "t2", "name": "", "duration": 125000},
		{"name": "Legacy no id"},
		{},
		"junk",
	]
	var rows := M.timeline_rows(tls)
	t.eq(rows.map(func(r: Dictionary) -> Dictionary: return r.payload), [
		{"type": "timeline", "value": "tmve1ppeug1t", "label": "Timeline"},
		{"type": "timeline", "value": "t2", "label": "t2"},
		{"type": "timeline", "value": "Legacy no id", "label": "Legacy no id"},
	], "web map {id: t.id || t.name, label: t.name || t.id}; nameless + idless skipped")
	t.eq(rows[0].tip, "Timeline · 1:00 · 2 layers", "tooltip: duration + layers")
	t.eq(rows[1].tip, "t2 · 2:05 · 0 layers", "no layers array")
	t.eq(M.timeline_rows(tls, "LEG").size(), 1, "filter on label")
	t.eq(M.timeline_rows(null), [], "no timelines key")
