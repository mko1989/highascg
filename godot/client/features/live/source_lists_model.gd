extends RefCounted
## WO-623 C — rows of the Sources "Templates" and "Timelines" tabs, pure (web client/components/sources-panel-templates.js
## renderTemplatesBrowser, sources-panel-render.js + sources-panel-helpers.js renderSourceList 'timeline').
## A row is {text, pill, tip, kind, payload}; payload is the web makeDraggable JSON {type, value, label}.

static var _SHADER_RE: RegEx


## GET /api/shaders → {lowercased id: library name} (web refreshShaderNames; owner bug 27.07.26: renamed shaders
## must show their library name, not the Caspar TLS file id).
static func shader_names(resp: Variant) -> Dictionary:
	var out := {}
	var list: Variant = (resp as Dictionary).get("shaders", []) if resp is Dictionary else []
	for x in (list if list is Array else []):
		if x is Dictionary and str(x.get("id", "")) != "":
			var name := str(x.get("name", "")) if x.get("name") != null else ""
			out[str(x.id).to_lower()] = name if name != "" else str(x.id)
	return out


## Caspar TLS entries ({id, label}) → rows; `filter` matches label (else id), case-insensitive, like the web.
static func template_rows(templates: Variant, names: Dictionary, filter := "") -> Array:
	if _SHADER_RE == null:
		_SHADER_RE = RegEx.create_from_string("shaders/(sh-[a-z0-9-]+)$")
	var f := filter.strip_edges().to_lower()
	var rows := []
	for item in (templates if templates is Array else []):
		if not item is Dictionary:
			continue
		var raw_label: Variant = item.get("label")
		var id := str(item.get("id")) if item.get("id") != null else (str(raw_label) if raw_label != null else "")
		if id == "":
			continue
		var label := str(raw_label) if raw_label != null else id
		if f != "" and not (label if label != "" else id).to_lower().contains(f):
			continue
		var norm := id.to_lower().replace("\\", "/")
		var row := {"text": label, "pill": "FT", "tip": label, "kind": "template",
			"payload": {"type": "template", "value": id, "label": label}}
		var m := _SHADER_RE.search(norm)
		if norm.contains("lower-thirds/lt-") or norm.contains("lower_thirds/lt-"):
			row.kind = "cg"  # CG Studio lower third
		elif m != null:
			var shown := str(names.get(m.get_string(1), label))
			row.merge({"text": shown, "pill": "FX", "kind": "shader", "tip": "%s (%s) — Shader FX template" % [shown, label]}, true)
		rows.append(row)
	return rows


## project.timelines.timelines → rows {id: t.id || t.name, label: t.name || t.id}; filter on label (else id).
static func timeline_rows(timelines: Variant, filter := "") -> Array:
	var f := filter.strip_edges().to_lower()
	var rows := []
	for t in (timelines if timelines is Array else []):
		if not t is Dictionary:
			continue
		var tid := str(t.get("id", "")) if str(t.get("id", "")) != "" else str(t.get("name", ""))
		var label := str(t.get("name", "")) if str(t.get("name", "")) != "" else tid
		if tid == "" or (f != "" and not label.to_lower().contains(f)):
			continue
		var dur := float(t.get("duration", 0)) / 1000.0
		rows.append({"text": label, "pill": "TL", "kind": "timeline",
			"tip": "%s · %d:%02d · %d layers" % [label, int(dur) / 60, int(dur) % 60, (t.get("layers", []) as Array).size() if t.get("layers") is Array else 0],
			"payload": {"type": "timeline", "value": tid, "label": label}})
	return rows
