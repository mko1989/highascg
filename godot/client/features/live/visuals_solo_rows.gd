extends RefCounted
## WO-1051 — Sources ▸ Live: the Visuals' layer positions as child rows under the `visuals` shm row (the local Visuals tab's
## ring, found through group `visuals_canvas`), while that tab is a Live source. One row per position of the bank on the
## canvas (A/B: the crossfader's side), top layer first like the Visuals layer list: `L<n> · <what runs>`, muted when the
## layer is hidden. A row drags {type: "shm", value: "shm://<ring>-L<n>", label: "Visuals L<n>", routeType: "shm"} — a
## ring row's shape, so every drop target takes it — and starting the drag makes the position solo (visuals_solo.gd: the
## ring starts while the drag is in flight). The row's toggle shows solo on / off; turning it off puts the layer back into
## the canvas. The server lists those rings too (`<ring>-L<n>`): hidden at the top level, they are these children.

const L := preload("res://features/visuals/visuals_layers.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const INDENT := 18


## The local Visuals tab's ring ("" = no tab here).
static func ring_of(tab: Node) -> String:
	return str(tab.ring_name) if tab != null and tab.get("solo") != null else ""


## `rows` (live sources + shm rings) with the server's `<ring>-L<n>` rows dropped and this tab's position rows under its
## `shm://<ring>` row.
static func insert(rows: Array, tab: Node) -> Array:
	var ring := ring_of(tab)
	if ring == "":
		return rows
	var re := RegEx.create_from_string("^shm://" + _quote(ring) + "-L\\d+$")
	var out := []
	for s in rows:
		if s.get("type") == "shm" and re.search(str(s.get("value", ""))) != null:
			continue
		out.append(s)
		if s.get("type") == "shm" and str(s.get("value", "")) == "shm://" + ring:
			out.append_array(children(tab))
	return out


## The child rows (top layer first), [] while the tab is not a Live source.
static func children(tab: Node) -> Array:
	if ring_of(tab) == "" or not tab.solo.live_source():
		return []
	var ls: Array = tab.solo.air_layers()
	var on: Array = tab.solo.positions()
	var out := []
	for i in range(ls.size() - 1, -1, -1):
		var n := i + 1
		var l: Dictionary = ls[i]
		out.append({"type": "shm", "value": "shm://" + M.solo_ring(ring_of(tab), n), "label": "Visuals L%d" % n,
			"routeType": "shm", "visualsSolo": n, "text": "L%d · %s" % [n, L.describe(l)],
			"muted": l.get("visible", true) == false, "solo": n in on})
	return out


## What a child row drags: a ring row's payload.
static func payload(s: Dictionary) -> Dictionary:
	return {"type": "shm", "value": s.value, "label": s.label, "routeType": "shm"}


## What the panel compares to know the children changed (the 0.5 s check, cheaper than a full rebuild).
static func signature(tab: Node) -> String:
	return JSON.stringify([ring_of(tab), children(tab)]) if tab != null else ""


## One indented child row: {panel, toggle, drag (the drag-forwarding getter: solos the position, returns the payload)}.
static func row(s: Dictionary, tab: Node) -> Dictionary:
	var n := int(s.visualsSolo)
	var r := {}
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = ThemeBuilder.BG_PANEL
	sb.set_content_margin_all(3)
	sb.content_margin_left = INDENT
	sb.set_corner_radius_all(3)
	panel.add_theme_stylebox_override("panel", sb)
	panel.tooltip_text = "%s — this layer position alone, transparent\n%s\nDrag onto a look: it plays there and leaves the visuals picture" % [
		s.label, s.value]
	r.panel = panel
	var h := HBoxContainer.new()
	h.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(h)
	var name := Label.new()
	name.text = str(s.text)
	name.clip_text = true
	name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name.add_theme_font_size_override("font_size", 12)
	name.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED if s.muted else ThemeBuilder.TEXT)
	name.mouse_filter = Control.MOUSE_FILTER_IGNORE
	h.add_child(name)
	r.name = name
	var b := Button.new()
	b.text = "solo"
	b.toggle_mode = true
	b.flat = true
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", 11)
	b.set_pressed_no_signal(s.solo)
	b.tooltip_text = "On: this layer plays only as %s (not in the visuals picture). Off: back into the picture" % s.value
	b.toggled.connect(func(on: bool) -> void: tab.solo.set_solo(n, on))
	h.add_child(b)
	r.toggle = b
	r.drag = func(_at: Vector2) -> Variant:
		tab.solo.set_solo(n, true)
		if panel.is_inside_tree() and panel.get_viewport().gui_is_dragging():
			var p := Label.new()
			p.text = "＋ " + str(s.label)
			panel.set_drag_preview(p)
		return payload(s)
	panel.set_drag_forwarding(r.drag, Callable(), Callable())
	return r


static func _quote(s: String) -> String:
	var out := ""
	for c in s:
		out += "\\" + c if c in ".^$*+?()[]{}|\\-" else c
	return out
