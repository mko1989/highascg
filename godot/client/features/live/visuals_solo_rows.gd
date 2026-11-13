extends RefCounted
## WO-1051 — Sources ▸ Live: the Visuals' layer positions as child rows under the `visuals` shm row (the local Visuals tab's
## ring, found through group `visuals_canvas`), while that tab is a Live source. One row per position of the bank on the
## canvas (A/B: the crossfader's side), top layer first like the Visuals layer list: `L<n> · <what runs>`, muted when the
## layer is hidden. A row drags {type: "shm", value: "shm://<ring>-L<n>", label: "Visuals L<n>", routeType: "shm"} — a
## ring row's shape, so every drop target takes it — and starting the drag makes the position solo (visuals_solo.gd: the
## ring starts while the drag is in flight). The row's toggle shows solo on / off; turning it off puts the layer back into
## the canvas. The server lists those rings too (`<ring>-L<n>`): hidden at the top level, they are these children.
## WO-1053 route groups: GROUP rows first (`<name> · L4 L5`, dragging `shm://<ring>-<name>`, label `Visuals <name>`), then
## the layer rows. A layer row's toggle became a route menu: Main / Own (`L<n>`) / each group / New group… (the first one
## is `overlay`, then `group-2`, …). A layer row in a group drags the group's ring and changes nothing (a drag never pulls
## a layer out of its group); otherwise a drag makes it Own as before. Server rows `<ring>-<group>` are hidden too.

const L := preload("res://features/visuals/visuals_layers.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const INDENT := 18


## The local Visuals tab's ring ("" = no tab here).
static func ring_of(tab: Node) -> String:
	return str(tab.ring_name) if tab != null and tab.get("solo") != null else ""


## `rows` (live sources + shm rings) with the server's `<ring>-<key>` rows dropped (L<n>, the groups, rings still
## draining) and this tab's group + position rows under its `shm://<ring>` row.
static func insert(rows: Array, tab: Node) -> Array:
	var ring := ring_of(tab)
	if ring == "":
		return rows
	var keys := ["L\\d+"]
	for k in tab.solo.groups().keys() + tab.solo.pubs.keys():
		if not str(k).begins_with("L"):
			keys.append(_quote(str(k)))
	var re := RegEx.create_from_string("^shm://" + _quote(ring) + "-(" + "|".join(keys) + ")$")
	var out := []
	for s in rows:
		if s.get("type") == "shm" and re.search(str(s.get("value", ""))) != null:
			continue
		out.append(s)
		if s.get("type") == "shm" and str(s.get("value", "")) == "shm://" + ring:
			out.append_array(children(tab))
	return out


## The child rows — groups first, then the layers top first — [] while the tab is not a Live source.
static func children(tab: Node) -> Array:
	if ring_of(tab) == "" or not tab.solo.live_source():
		return []
	var ls: Array = tab.solo.air_layers()
	var gs: Dictionary = tab.solo.groups()
	var route: Dictionary = tab.solo.routes()
	var out := []
	for g in gs:  # WO-1053
		out.append({"type": "shm", "value": "shm://" + M.key_ring(ring_of(tab), g), "label": "Visuals " + g,
			"routeType": "shm", "visualsGroup": g, "muted": false, "route": g,
			"text": "%s · %s" % [g, " ".join(gs[g].map(func(p: int) -> String: return M.own_key(p)))]})
	for i in range(ls.size() - 1, -1, -1):
		var n := i + 1
		var l: Dictionary = ls[i]
		var key := str(route.get(n, ""))
		var grouped := key != "" and key != M.own_key(n)
		out.append({"type": "shm", "value": "shm://" + M.key_ring(ring_of(tab), key if grouped else M.own_key(n)),
			"label": "Visuals " + (key if grouped else M.own_key(n)), "routeType": "shm", "visualsSolo": n,
			"text": "L%d · %s" % [n, L.describe(l)], "muted": l.get("visible", true) == false, "route": key})
	return out


## WO-1053: a Visuals child row (a group or a layer position)?
static func is_child(s: Dictionary) -> bool:
	return s.has("visualsSolo") or s.has("visualsGroup")


## WO-1053: the route menu's entries for position `n`: [[text, key]] — Main, Own, each group, New group… (key "+").
static func menu_items(n: int, tab: Node) -> Array:
	var out := [["Main (in visuals)", ""], ["Own (%s)" % M.own_key(n), M.own_key(n)]]
	for g in tab.solo.groups():
		out.append(["Group " + g, g])
	out.append(["New group… (%s)" % tab.solo.new_group(), "+"])
	return out


## What a child row drags: a ring row's payload.
static func payload(s: Dictionary) -> Dictionary:
	return {"type": "shm", "value": s.value, "label": s.label, "routeType": "shm"}


## What the panel compares to know the children changed (the 0.5 s check, cheaper than a full rebuild).
static func signature(tab: Node) -> String:
	return JSON.stringify([ring_of(tab), children(tab)]) if tab != null else ""


## One indented child row: {panel, menu (layer rows: the route menu), keys (menu id → key), drag (the drag-forwarding
## getter: a layer row not in a group goes Own, then the payload)}.
static func row(s: Dictionary, tab: Node) -> Dictionary:
	var group := s.has("visualsGroup")
	var n := 0 if group else int(s.visualsSolo)
	var key := str(s.get("route", ""))
	var r := {}
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = ThemeBuilder.BG_PANEL
	sb.set_content_margin_all(3)
	sb.content_margin_left = INDENT
	sb.set_corner_radius_all(3)
	panel.add_theme_stylebox_override("panel", sb)
	panel.tooltip_text = ("%s — these layer positions in one transparent picture\n%s\nDrag onto a look" if group else
		"%s — this layer position alone, transparent\n%s\nDrag onto a look: it plays there and leaves the visuals picture") % [
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
	if not group:  # WO-1053: the route menu (was WO-1051's solo toggle)
		var b := MenuButton.new()
		b.text = "main" if key == "" else ("own" if key == M.own_key(n) else key)
		b.flat = true
		b.focus_mode = Control.FOCUS_NONE
		b.add_theme_font_size_override("font_size", 11)
		b.tooltip_text = "Where layer L%d plays: Main (in the visuals picture), Own (%s), or a group's ring" % [n,
			M.key_ring(ring_of(tab), M.own_key(n))]
		var pop := b.get_popup()
		r.keys = []
		for it in menu_items(n, tab):
			pop.add_radio_check_item(it[0], r.keys.size())
			pop.set_item_checked(r.keys.size(), it[1] == key)
			r.keys.append(it[1])
		pop.id_pressed.connect(func(id: int) -> void:
			var k: String = r.keys[id]
			tab.solo.set_route(n, tab.solo.new_group() if k == "+" else k))
		h.add_child(b)
		r.menu = b
	r.drag = func(_at: Vector2) -> Variant:
		var pay := payload(s)
		if not group:  # the route now (the row may be up to 0.5 s old)
			var k: String = tab.solo.route_of(n)
			if k == "" or k == M.own_key(n):
				tab.solo.set_route(n, M.own_key(n))  # WO-1051: a drag makes it Own
				k = M.own_key(n)
			# WO-1053: in a group the drag carries the group's ring and changes nothing
			pay = payload({"value": "shm://" + M.key_ring(ring_of(tab), k), "label": "Visuals " + k})
		if panel.is_inside_tree() and panel.get_viewport().gui_is_dragging():
			var p := Label.new()
			p.text = "＋ " + str(pay.label)
			panel.set_drag_preview(p)
		return pay
	panel.set_drag_forwarding(r.drag, Callable(), Callable())
	return r


static func _quote(s: String) -> String:
	var out := ""
	for c in s:
		out += "\\" + c if c in ".^$*+?()[]{}|\\-" else c
	return out
