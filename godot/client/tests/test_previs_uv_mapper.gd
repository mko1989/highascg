extends RefCounted
## WO-607 T2 — the JS __selfTest() cases of client/lib/previs-uv-mapper.js, same inputs and numbers
## (JS baseline 2026-10-17: {"passed":20,"failed":0}), plus the Godot UV-transform helper.

const M := preload("res://features/previs/previs_uv_mapper.gd")
var t

const VC := {"width": 1920.0, "height": 1080.0}
const CONTENT := {"width": 1920.0, "height": 1080.0}


func _approx(a: float, b: float) -> bool:
	return absf(a - b) < 1e-6


func test_full_canvas_screen() -> void:
	var r: Variant = M.compute_screen_uv({"canvasX": 0, "canvasY": 0, "canvasWidth": 1920, "canvasHeight": 1080, "worldWidth": 16, "worldHeight": 9}, CONTENT, VC)
	t.ok(r != null, "full-canvas screen returns result")
	t.ok(_approx(r.uvs.uLeft, 0) and _approx(r.uvs.uRight, 1), "full-canvas UV u = 0..1")
	t.ok(_approx(r.uvs.vBottom, 0) and _approx(r.uvs.vTop, 1), "full-canvas UV v = 0..1")
	t.ok(_approx(r.meshWidth, 16) and _approx(r.meshHeight, 9), "full-canvas mesh = screen")
	t.ok(_approx(r.offsetX, 0) and _approx(r.offsetY, 0), "full-canvas offset = centre")


func test_right_half_screen() -> void:
	var r: Variant = M.compute_screen_uv({"canvasX": 960, "canvasY": 0, "canvasWidth": 960, "canvasHeight": 1080, "worldWidth": 8, "worldHeight": 9}, CONTENT, VC)
	t.ok(r != null, "right-half screen returns result")
	t.ok(_approx(r.uvs.uLeft, 0.5) and _approx(r.uvs.uRight, 1), "right-half UV uLeft = 0.5")
	t.ok(_approx(r.uvs.vBottom, 0) and _approx(r.uvs.vTop, 1), "right-half UV v full")
	t.ok(_approx(r.meshWidth, 8) and _approx(r.meshHeight, 9), "right-half mesh = full screen")


func test_off_canvas_screen_is_null() -> void:
	var r: Variant = M.compute_screen_uv({"canvasX": 2000, "canvasY": 0, "canvasWidth": 100, "canvasHeight": 100, "worldWidth": 1, "worldHeight": 1}, CONTENT, VC)
	t.ok(r == null, "off-canvas screen returns null")


func test_small_content_centred() -> void:
	var small := {"width": 960.0, "height": 540.0}
	var b: Dictionary = M.compute_content_bounds(small, VC)
	t.ok(_approx(b.startX, 480) and _approx(b.startY, 270), "small content centred on canvas")
	var r: Variant = M.compute_screen_uv({"canvasX": 0, "canvasY": 0, "canvasWidth": 1920, "canvasHeight": 1080, "worldWidth": 16, "worldHeight": 9}, small, VC)
	t.ok(r != null, "screen shows centred small content")
	t.ok(_approx(r.meshWidth, (960.0 / 1920.0) * 16.0), "mesh width = content proportion * screen world width")


func test_bottom_left_panel() -> void:
	var region := {"worldWidth": 4, "worldHeight": 3, "canvasX": 0, "canvasY": 0, "canvasWidth": 1920, "canvasHeight": 1080}
	var b: Dictionary = M.compute_content_bounds(CONTENT, VC)
	var r: Dictionary = M.compute_panel_uv({"localX": 0, "localY": 0, "width": 1, "height": 1}, region, b)
	t.ok(r.hasContent == true, "bottom-left panel has content")
	t.ok(_approx(r.panelOffsetX, -1.5) and _approx(r.panelOffsetY, -1), "panel offset from screen centre")
	t.ok(_approx(r.panelWidth, 1.001) and _approx(r.panelHeight, 1.001), "panel includes gap eliminator")
	t.ok(_approx(r.uvs.uLeft, 0) and _approx(r.uvs.uRight, 0.25), "bottom-left panel UV u = 0..0.25")
	t.ok(_approx(r.uvs.vBottom, 0) and _approx(r.uvs.vTop, 1.0 / 3.0), "bottom-left panel UV v at bottom of content")


func test_out_of_content_panel() -> void:
	var region := {"worldWidth": 4, "worldHeight": 3, "canvasX": 0, "canvasY": 0, "canvasWidth": 200, "canvasHeight": 100}
	var b: Dictionary = M.compute_content_bounds({"width": 50.0, "height": 50.0}, {"width": 200.0, "height": 100.0})
	var r: Dictionary = M.compute_panel_uv({"localX": 3, "localY": 2, "width": 1, "height": 1}, region, b)
	t.ok(r.hasContent == false, "out-of-content panel reports hasContent=false")
	t.ok(r.contentWidth == 0 and r.contentHeight == 0, "out-of-content panel content dims = 0")


func test_led_and_godot_uv_transform() -> void:
	var s: Dictionary = M.led_panel_size_meters({"pixelPitch": 2.6, "panelWidth": 192, "panelHeight": 192})
	t.ok(_approx(s.panelWidthMeters, 0.4992), "192 px × 2.6 mm = 0.4992 m")
	var g: Dictionary = M.uv_rect_to_godot({"uLeft": 0.5, "uRight": 1.0, "vBottom": 0.0, "vTop": 0.5})
	# bottom half of the content (OpenGL v 0..0.5) = Godot rows 0.5..1.0
	t.eq(g.offset, Vector3(0.5, 0.5, 0.0))
	t.eq(g.scale, Vector3(0.5, 0.5, 1.0))
