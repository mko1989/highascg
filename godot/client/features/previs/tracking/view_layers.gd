extends RefCounted
## WO-616 tracking_view.gd's drawn layers over the camera picture (split out by WO-1091 for the 500-line limit):
## markers (T5b), detection boxes + unseen world persons (T9b / T10b), ROI masks (T9c), trigger zones (T7), the
## walk line (T10d) and follow beams (T11). Each takes the view `v` and draws on it during its _draw.

const O := preload("res://features/previs/tracking/tracking_overlay.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")


static func marks(v: Control, font: Font) -> void:
	for m in v.marks:
		if m.centre == null:
			continue
		var col: Color = m.color
		if m.stale:
			col.a = 0.35
		var sel: bool = m.id == v.selected_marker and m.own
		if (m.ring as PackedVector2Array).size() >= 2:
			v.draw_polyline(v._xf(m.ring), col, 3.0 if sel else 2.0, true)
		var c: Vector2 = v.to_view(m.centre)
		var foot: Vector2 = v.to_view(m.foot) if m.get("foot") != null else c
		var top: Vector2 = v.to_view(m.top) if m.top != null else foot
		if m.get("assisted", false) and foot.distance_to(c) > 1.0:
			v.draw_line(c, foot, Color(col, col.a * 0.6), 1.5, true)
			v.draw_arc(foot, 5.0, 0.0, TAU, 14, col, 2.0, true)
		v.draw_line(foot, top, col, 2.0, true)
		v.draw_circle(top, 5.0 if sel else 4.0, col)
		var label := "%s%s%s" % [m.name, " · stale" if m.stale else "", pin_tag(m)]
		v.draw_string(font, top + Vector2(8, -4), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 14 if sel else 13, col)
		if sel:
			v.draw_arc(c, 4.0, 0.0, TAU, 12, ThemeBuilder.TEXT, 2.0, true)


static func pin_tag(m: Dictionary) -> String:
	if m.get("assisted", false):
		return " · assist"
	if m.get("driven", false):
		return " · AI" if float(m.get("status", 1.0)) > 0.0 else " · AI lost"
	return ""


static func boxes(v: Control, font: Font) -> void:
	if v.entry.is_empty() or v.detections.get("enabled") != true or not (v.markers_mode or v.zones_mode):
		return
	var r: Vector2 = v._raster()
	var cols := {}
	for m in v.marks:
		cols[int(m.id)] = m.color
	for cam in v.detections.get("cameras", []):
		if not (cam is Dictionary) or str(cam.get("id", "")) != str(v.entry.get("id", "")) or cam.get("stale") == true:
			continue
		for p in cam.get("persons", []):
			var b: Array = p.get("box", [])
			if b.size() < 4:
				continue
			var pinned: bool = p.has("marker")
			var col: Color = cols.get(int(p.get("marker", 0)), ThemeBuilder.ACCENT) if pinned else Color(ThemeBuilder.ACCENT, 0.7)
			if float(p.get("age_s", 0.0)) > 0.0:
				col.a *= 0.45  # coasting: the tracker predicts it, no box matched this step
			var a: Vector2 = v.to_view(Vector2(float(b[0]) * r.x, float(b[1]) * r.y))
			var z: Vector2 = v.to_view(Vector2(float(b[2]) * r.x, float(b[3]) * r.y))
			v.draw_rect(Rect2(a, z - a), col, false, 3.0 if pinned else 1.5)
			if v.detect_mode and v.masks_on:
				v.draw_circle(Vector2((a.x + z.x) / 2.0, z.y), 4.0, col)  # the feet point the masks test
			var wtag := "P%d · " % int(p.world) if p.has("world") else ""
			v.draw_string(font, a + Vector2(3, -4), "%s#%d %.0f%%" % [wtag, int(p.get("tid", 0)), float(p.get("score", 0.0)) * 100.0],
				HORIZONTAL_ALIGNMENT_LEFT, -1, 12, col)
	unseen(v, font, cols)


## T10b: world persons this camera has no box for (seen by another camera, or predicted) — a hollow ring at their
## floor point, tagged with who sees them: the occlusion handover made visible.
static func unseen(v: Control, font: Font, cols: Dictionary) -> void:
	var world: Variant = v.detections.get("world")
	if not (world is Dictionary) or world.get("fused") != true or not (v.entry.get("cam") is Dictionary):
		return
	var me := str(v.entry.get("id", ""))
	for w in world.get("persons", []):
		if not (w is Dictionary) or (w.get("cameras", []) as Array).has(me) and float(w.get("age_s", 0.0)) <= 0.0:
			continue
		var at: Variant = O.shown(v.entry, [[float(w.x), float(w.y), float(world.get("plane_z", 0.0))]])[0]
		if at == null:
			continue
		var col: Color = cols.get(int(w.get("marker", 0)), ThemeBuilder.ACCENT) if w.has("marker") else Color(ThemeBuilder.ACCENT, 0.7)
		var q: Vector2 = v.to_view(Vector2(at[0], at[1]))
		v.draw_arc(q, 14.0, 0.0, TAU, 28, col, 2.0, true)
		var who := "predicted" if float(w.get("age_s", 0.0)) > 0.0 else "/".join(w.get("cameras", []))
		v.draw_string(font, q + Vector2(16, 4), "P%d · %s" % [int(w.id), who], HORIZONTAL_ALIGNMENT_LEFT, -1, 12, col)


static func masks(v: Control) -> void:
	var r: Vector2 = v._raster()
	for m in v.mask_shapes:
		var poly := PackedVector2Array()
		for q in m.vertices:
			poly.append(v.to_view(Vector2(float(q[0]) * r.x, float(q[1]) * r.y)))
		var live: bool = v.masks_on and m.enabled
		var col := Color(ThemeBuilder.ACCENT_GREEN, 1.0 if live else 0.45)
		if live and poly.size() >= 3 and not Geometry2D.triangulate_polygon(poly).is_empty():
			v.draw_colored_polygon(poly, Color(col, 0.12))
		if poly.size() >= 2:
			var loop := poly.duplicate()
			if poly.size() >= 3:
				loop.append(poly[0])
			v.draw_polyline(loop, col, 3.0 if m.selected else 1.5, true)
		if m.selected and v.mask_drawing:
			for p in poly:
				v.draw_circle(p, 4.0, col)


static func zones(v: Control, font: Font) -> void:
	for z in v.zone_shapes:
		var col := Color(z.color)
		var loop: Array = z.loop
		if loop.size() < 2:
			continue
		var px := O.shown(v.entry, loop)
		if z.occupied and not px.has(null) and px.size() >= 4:
			var poly := PackedVector2Array()
			for i in px.size() - 1:
				poly.append(v.to_view(Vector2(px[i][0], px[i][1])))
			if not Geometry2D.triangulate_polygon(poly).is_empty():
				v.draw_colored_polygon(poly, Color(col, 0.3))
		for i in loop.size() - 1:
			for pl in O.edge(v.entry, loop[i], loop[i + 1]):
				v.draw_polyline(v._xf(pl), col, 3.0 if z.selected else 1.5, true)
		if z.selected and v.zone_drawing:
			for p in px:
				if p != null:
					v.draw_circle(v.to_view(Vector2(p[0], p[1])), 4.0, col)
		var at: Variant = px[0]
		if at != null:
			v.draw_string(font, v.to_view(Vector2(at[0], at[1])) + Vector2(6, -6), z.name, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, col)


static func walk(v: Control, font: Font) -> void:
	if v.walk_line.is_empty() or not v.entry.get("cam") is Dictionary:
		return
	var a := [v.walk_line.a[0], v.walk_line.a[1], v.walk_line.z]
	var col := Color(ThemeBuilder.ACCENT_HOVER, 0.9)
	for pl in O.edge(v.entry, a, [v.walk_line.b[0], v.walk_line.b[1], v.walk_line.z]):
		v.draw_polyline(v._xf(pl), col, 3.0, true)
	var s: Variant = O.shown(v.entry, [a])[0]
	if s != null:
		v.draw_string(font, v.to_view(Vector2(s[0], s[1])) + Vector2(8, -8), "Walk: " + str(v.walk_line.name), HORIZONTAL_ALIGNMENT_LEFT, -1, 13, col)


static func beams(v: Control, font: Font) -> void:
	for b in v.beams:
		var col := Color(ThemeBuilder.WARN, 0.95 if b.live else 0.4)
		for pl in O.edge(v.entry, b.from, b.to):
			v.draw_polyline(v._xf(pl), col, 2.5 if b.live else 1.5, true)
		var head: Variant = O.shown(v.entry, [b.from])[0]
		if head != null:
			var at: Vector2 = v.to_view(Vector2(head[0], head[1]))
			v.draw_rect(Rect2(at - Vector2(5, 5), Vector2(10, 10)), col)
			v.draw_string(font, at + Vector2(8, 14), b.name, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, col)
