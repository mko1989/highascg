extends RefCounted
## WO-607 T2 — 1:1 port of client/lib/previs-uv-mapper.js (WO-17; itself from Show Creator's
## ScreenSystem.tsx). Pure functions; dictionaries mirror the JS objects. Conventions (unchanged):
## virtual canvas y=0 is TOP; world metres, +Y up; UV v=0 is BOTTOM; panel localX/localY from the
## screen's bottom-left in metres. Tests: res://tests/test_previs_uv_mapper.gd (= the JS __selfTest cases).


## Content smaller than the canvas is centred; larger is clamped. null/0 dims → fill the canvas.
static func compute_content_bounds(content_dims: Variant, virtual_canvas: Dictionary) -> Dictionary:
	var vw: float = virtual_canvas.width
	var vh: float = virtual_canvas.height
	var cw: float = vw
	var ch: float = vh
	if content_dims is Dictionary:
		if float(content_dims.get("width", 0)) > 0:
			cw = float(content_dims.width)
		if float(content_dims.get("height", 0)) > 0:
			ch = float(content_dims.height)
	var ew := minf(cw, vw)
	var eh := minf(ch, vh)
	return {"startX": (vw - ew) / 2.0, "startY": (vh - eh) / 2.0, "width": ew, "height": eh}


## UV rect + mesh size/offset for a flat screen showing part of the virtual canvas; null = no overlap.
static func compute_screen_uv(region: Dictionary, content_dims: Variant, virtual_canvas: Dictionary) -> Variant:
	var content := compute_content_bounds(content_dims, virtual_canvas)
	var s_x0: float = region.canvasX
	var s_x1: float = region.canvasX + region.canvasWidth
	var s_y0: float = region.canvasY
	var s_y1: float = region.canvasY + region.canvasHeight
	var c_x1: float = content.startX + content.width
	var c_y1: float = content.startY + content.height
	var o_x0 := maxf(s_x0, content.startX)
	var o_x1 := minf(s_x1, c_x1)
	var o_y0 := maxf(s_y0, content.startY)
	var o_y1 := minf(s_y1, c_y1)
	if o_x0 >= o_x1 or o_y0 >= o_y1:
		return null
	var uvs := {
		"uLeft": (o_x0 - content.startX) / content.width,
		"uRight": (o_x1 - content.startX) / content.width,
		"vBottom": 1.0 - (o_y1 - content.startY) / content.height,
		"vTop": 1.0 - (o_y0 - content.startY) / content.height,
	}
	var cx := (o_x0 + o_x1) / 2.0
	var cy := (o_y0 + o_y1) / 2.0
	return {
		"uvs": uvs,
		"meshWidth": ((o_x1 - o_x0) / float(region.canvasWidth)) * float(region.worldWidth),
		"meshHeight": ((o_y1 - o_y0) / float(region.canvasHeight)) * float(region.worldHeight),
		"offsetX": ((cx - (s_x0 + s_x1) / 2.0) / float(region.canvasWidth)) * float(region.worldWidth),
		"offsetY": -((cy - (s_y0 + s_y1) / 2.0) / float(region.canvasHeight)) * float(region.worldHeight),
	}


## Panel + content geometry for one panel of an irregular (composite) screen.
static func compute_panel_uv(panel: Dictionary, region: Dictionary, content_bounds: Dictionary, gap_m := 0.001) -> Dictionary:
	var ww: float = region.worldWidth
	var wh: float = region.worldHeight
	var px0: float = region.canvasX + (float(panel.localX) / ww) * float(region.canvasWidth)
	var px1: float = region.canvasX + ((float(panel.localX) + float(panel.width)) / ww) * float(region.canvasWidth)
	var py0: float = region.canvasY + (1.0 - (float(panel.localY) + float(panel.height)) / wh) * float(region.canvasHeight)
	var py1: float = region.canvasY + (1.0 - float(panel.localY) / wh) * float(region.canvasHeight)
	var c_x1: float = content_bounds.startX + content_bounds.width
	var c_y1: float = content_bounds.startY + content_bounds.height
	var o_x0 := maxf(px0, content_bounds.startX)
	var o_x1 := minf(px1, c_x1)
	var o_y0 := maxf(py0, content_bounds.startY)
	var o_y1 := minf(py1, c_y1)
	var p_off_x: float = float(panel.localX) + float(panel.width) / 2.0 - ww / 2.0
	var p_off_y: float = float(panel.localY) + float(panel.height) / 2.0 - wh / 2.0
	var p_w: float = float(panel.width) + gap_m
	var p_h: float = float(panel.height) + gap_m
	if o_x0 >= o_x1 or o_y0 >= o_y1:
		return {
			"hasContent": false, "panelOffsetX": p_off_x, "panelOffsetY": p_off_y,
			"panelWidth": p_w, "panelHeight": p_h, "contentOffsetX": p_off_x, "contentOffsetY": p_off_y,
			"contentWidth": 0.0, "contentHeight": 0.0,
			"uvs": {"uLeft": 0.0, "uRight": 1.0, "vBottom": 0.0, "vTop": 1.0},
		}
	var pcw := px1 - px0
	var pch := py1 - py0
	var off_rx := (((o_x0 + o_x1) / 2.0) - (px0 + px1) / 2.0) / pcw
	var off_ry := -(((o_y0 + o_y1) / 2.0) - (py0 + py1) / 2.0) / pch
	return {
		"hasContent": true, "panelOffsetX": p_off_x, "panelOffsetY": p_off_y,
		"panelWidth": p_w, "panelHeight": p_h,
		"contentOffsetX": p_off_x + off_rx * float(panel.width),
		"contentOffsetY": p_off_y + off_ry * float(panel.height),
		"contentWidth": p_w * ((o_x1 - o_x0) / pcw),
		"contentHeight": p_h * ((o_y1 - o_y0) / pch),
		"uvs": {
			"uLeft": (o_x0 - content_bounds.startX) / content_bounds.width,
			"uRight": (o_x1 - content_bounds.startX) / content_bounds.width,
			"vBottom": 1.0 - (o_y1 - content_bounds.startY) / content_bounds.height,
			"vTop": 1.0 - (o_y0 - content_bounds.startY) / content_bounds.height,
		},
	}


## LED pixel pitch (mm) + panel pixels → panel size in metres.
static func led_panel_size_meters(led: Dictionary) -> Dictionary:
	return {
		"panelWidthMeters": float(led.panelWidth) * float(led.pixelPitch) / 1000.0,
		"panelHeightMeters": float(led.panelHeight) * float(led.pixelPitch) / 1000.0,
	}


static func rotate_2d(x: float, y: float, angle_z: float) -> Vector2:
	return Vector2(x * cos(angle_z) - y * sin(angle_z), x * sin(angle_z) + y * cos(angle_z))


## Godot material UV transform (uv1_scale/uv1_offset) for a UVRect. Godot's UV v=0 is the TOP of the
## texture, the mapper's v=0 is the BOTTOM (OpenGL) → flip.
static func uv_rect_to_godot(uvs: Dictionary) -> Dictionary:
	var u0: float = uvs.uLeft
	var u1: float = uvs.uRight
	var v0: float = 1.0 - float(uvs.vTop)
	var v1: float = 1.0 - float(uvs.vBottom)
	return {"scale": Vector3(u1 - u0, v1 - v0, 1.0), "offset": Vector3(u0, v0, 0.0)}
