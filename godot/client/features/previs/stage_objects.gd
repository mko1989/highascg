extends RefCounted
## WO-614 T1 — previs stage objects as plain data (persisted in project.previs.stage.objects):
## LED walls from panel numbers, TVs, projection screens. Pure: normalise + derived geometry only,
## no nodes (stage_builder.gd turns them into meshes). Units: metres, degrees, pixels.
## Object origin = bottom-centre of the picture surface; the picture faces +Z (towards the audience).

const TYPES := ["led_wall", "tv", "projection"]

## Generic panels by pitch — every one an exact division of 500 mm (P = 500 / px).
const PANEL_PRESETS := [
	{"name": "500×500 P2.6 (192 px)", "px": [192, 192], "mm": [500, 500]},
	{"name": "500×500 P2.9 (168 px)", "px": [168, 168], "mm": [500, 500]},
	{"name": "500×500 P3.9 (128 px)", "px": [128, 128], "mm": [500, 500]},
	{"name": "500×1000 P3.9 (128×256 px)", "px": [128, 256], "mm": [500, 1000]},
	{"name": "500×500 P4.8 (104 px)", "px": [104, 104], "mm": [500, 500]},
]

const DEFAULTS := {
	"led_wall": {"name": "LED wall", "panel_px": [192, 192], "panel_mm": [500, 500], "panels": [10, 6], "curve_deg": 0.0, "depth_m": 0.08},
	"tv": {"name": "TV", "diagonal_in": 65.0, "aspect": [16, 9], "resolution": [3840, 2160], "portrait": false, "bezel_mm": 10.0, "depth_m": 0.06},
	"projection": {"name": "Projection", "screen_m": [4.0, 2.25], "rear": false, "throw": 1.5, "lens_shift_v": 0.0, "resolution": [1920, 1080], "brightness": 0.8},
}


static func new_object(type: String, existing: Array = []) -> Dictionary:
	var n := 1
	var ids := {}
	for o in existing:
		ids[str((o as Dictionary).get("id", ""))] = true
		if str((o as Dictionary).get("type", "")) == type:
			n += 1
	var id := "%s_%d" % [type, n]
	while ids.has(id):
		n += 1
		id = "%s_%d" % [type, n]
	var o := {"id": id, "type": type}
	o["name"] = "%s %d" % [DEFAULTS.get(type, {}).get("name", type), n]
	return normalize(o)


## Fill defaults, coerce types and clamp to sane ranges. Unknown keys are kept (forward compatible).
static func normalize(src: Dictionary) -> Dictionary:
	var o := src.duplicate(true)
	var type := str(o.get("type", "led_wall"))
	if not TYPES.has(type):
		type = "led_wall"
	o["type"] = type
	for k in DEFAULTS[type]:
		if not o.has(k):
			o[k] = DEFAULTS[type][k]
	o["id"] = str(o.get("id", type))
	o["name"] = str(o.get("name", type))
	o["position"] = _vec3(o.get("position"), [0.0, 0.0, 0.0], -500.0, 500.0)
	o["rotation"] = _vec3(o.get("rotation"), [0.0, 0.0, 0.0], -360.0, 360.0)
	o["visible"] = o.get("visible", true) != false
	match type:
		"led_wall":
			o["panel_px"] = _ivec2(o.panel_px, 1, 4096)
			o["panel_mm"] = _fvec2(o.panel_mm, 10.0, 4000.0)
			o["panels"] = _ivec2(o.panels, 1, 200)
			o["curve_deg"] = clampf(float(o.curve_deg), -30.0, 30.0)
			o["depth_m"] = clampf(float(o.depth_m), 0.0, 1.0)
		"tv":
			o["diagonal_in"] = clampf(float(o.diagonal_in), 5.0, 300.0)
			o["aspect"] = _fvec2(o.aspect, 0.1, 100.0)
			o["resolution"] = _ivec2(o.resolution, 1, 16384)
			o["portrait"] = o.portrait == true
			o["bezel_mm"] = clampf(float(o.bezel_mm), 0.0, 200.0)
			o["depth_m"] = clampf(float(o.depth_m), 0.0, 1.0)
		"projection":
			o["screen_m"] = _fvec2(o.screen_m, 0.1, 100.0)
			o["rear"] = o.rear == true
			o["throw"] = clampf(float(o.throw), 0.1, 20.0)
			o["lens_shift_v"] = clampf(float(o.lens_shift_v), -2.0, 2.0)
			o["resolution"] = _ivec2(o.resolution, 1, 16384)
			o["brightness"] = clampf(float(o.brightness), 0.0, 4.0)
	o["source"] = _source(o.get("source"), pixels(o))
	return o


## Picture size in pixels (what the object can show natively).
static func pixels(o: Dictionary) -> Vector2i:
	match str(o.get("type")):
		"led_wall":
			return Vector2i(int(o.panel_px[0]) * int(o.panels[0]), int(o.panel_px[1]) * int(o.panels[1]))
		"tv":
			var r := Vector2i(int(o.resolution[0]), int(o.resolution[1]))
			return Vector2i(r.y, r.x) if o.get("portrait", false) else r
		"projection":
			return Vector2i(int(o.resolution[0]), int(o.resolution[1]))
	return Vector2i(1920, 1080)


## Picture size in metres (flat width for a curved wall = sum of panel widths).
static func size_m(o: Dictionary) -> Vector2:
	match str(o.get("type")):
		"led_wall":
			return Vector2(float(o.panel_mm[0]) * int(o.panels[0]), float(o.panel_mm[1]) * int(o.panels[1])) / 1000.0
		"tv":
			var a: float = float(o.aspect[0]) / float(o.aspect[1])
			var d: float = float(o.diagonal_in) * 0.0254
			var h := d / sqrt(1.0 + a * a)
			var s := Vector2(a * h, h)
			return Vector2(s.y, s.x) if o.get("portrait", false) else s
		"projection":
			return Vector2(float(o.screen_m[0]), float(o.screen_m[1]))
	return Vector2.ONE


## Pixel pitch in mm (LED walls; 0 for others) and whether it is square.
static func pitch_mm(o: Dictionary) -> Vector2:
	if str(o.get("type")) != "led_wall":
		return Vector2.ZERO
	return Vector2(float(o.panel_mm[0]) / int(o.panel_px[0]), float(o.panel_mm[1]) / int(o.panel_px[1]))


static func pitch_is_square(o: Dictionary) -> bool:
	var p := pitch_mm(o)
	return absf(p.x - p.y) < 0.01


## Column edges of an LED wall in the object's XZ plane (cols + 1 points, left → right).
## curve_deg = angle between neighbouring panels; > 0 bends the edges towards the audience (+Z, concave).
static func column_edges(o: Dictionary) -> PackedVector2Array:
	var cols := int(o.panels[0])
	var pw := float(o.panel_mm[0]) / 1000.0
	var curve := deg_to_rad(float(o.get("curve_deg", 0.0)))
	var out := PackedVector2Array()
	if absf(curve) < 1e-6:
		for j in cols + 1:
			out.append(Vector2((j - cols / 2.0) * pw, 0.0))
		return out
	var r := (pw / 2.0) / sin(absf(curve) / 2.0)
	var sgn := signf(curve)
	for j in cols + 1:
		var phi := (j - cols / 2.0) * absf(curve)
		out.append(Vector2(r * sin(phi), sgn * r * (1.0 - cos(phi))))
	return out


## Projector position relative to the object origin (front: audience side +Z; rear: behind, −Z).
static func projector_offset(o: Dictionary) -> Vector3:
	var s := size_m(o)
	var d := float(o.get("throw", 1.5)) * s.x
	return Vector3(0.0, s.y * (0.5 + float(o.get("lens_shift_v", 0.0))), -d if o.get("rear", false) else d)


## Normalised crop (x, y, w, h in 0..1) of the source raster the object shows. Rect is in raster pixels.
static func uv_rect(o: Dictionary, raster: Vector2i) -> Vector4:
	var r: Dictionary = (o.get("source", {}) as Dictionary).get("rect", {})
	if raster.x <= 0 or raster.y <= 0:
		return Vector4(0, 0, 1, 1)
	return Vector4(float(r.get("x", 0)) / raster.x, float(r.get("y", 0)) / raster.y,
		float(r.get("w", raster.x)) / raster.x, float(r.get("h", raster.y)) / raster.y)


## A screen destination (config screenDestinations entry) → an object of `type` sized to its raster,
## bound to that destination's PGM surface with the full raster as its crop.
static func from_destination(dest: Dictionary, type: String, existing: Array = []) -> Dictionary:
	var o := new_object(type, existing)
	var w := maxi(1, int(dest.get("width", 1920)))
	var h := maxi(1, int(dest.get("height", 1080)))
	o["name"] = str(dest.get("label", o.name))
	match type:
		"led_wall":
			var p: Array = o.panel_px
			o["panels"] = [maxi(1, roundi(float(w) / int(p[0]))), maxi(1, roundi(float(h) / int(p[1])))]
		"tv", "projection":
			o["resolution"] = [w, h]
			if type == "projection":
				o["screen_m"] = [4.0, 4.0 * h / w]
	o["source"] = {"role": "pgm%d" % (int(dest.get("mainScreenIndex", 0)) + 1), "rect": {"x": 0, "y": 0, "w": w, "h": h}}
	return normalize(o)


static func _source(v: Variant, px: Vector2i) -> Dictionary:
	var s: Dictionary = v if v is Dictionary else {}
	var r: Dictionary = s.get("rect") if s.get("rect") is Dictionary else {}
	return {"role": str(s.get("role", "pgm1")), "rect": {
		"x": maxi(0, int(r.get("x", 0))), "y": maxi(0, int(r.get("y", 0))),
		"w": maxi(1, int(r.get("w", px.x))), "h": maxi(1, int(r.get("h", px.y)))}}


static func _vec3(v: Variant, d: Array, lo: float, hi: float) -> Array:
	var a: Array = v if v is Array and (v as Array).size() == 3 else d
	return [clampf(float(a[0]), lo, hi), clampf(float(a[1]), lo, hi), clampf(float(a[2]), lo, hi)]


static func _ivec2(v: Variant, lo: int, hi: int) -> Array:
	var a: Array = v if v is Array and (v as Array).size() == 2 else [lo, lo]
	return [clampi(int(a[0]), lo, hi), clampi(int(a[1]), lo, hi)]


static func _fvec2(v: Variant, lo: float, hi: float) -> Array:
	var a: Array = v if v is Array and (v as Array).size() == 2 else [lo, lo]
	return [clampf(float(a[0]), lo, hi), clampf(float(a[1]), lo, hi)]


## WO-617 2D views. Footprint = the picture line seen from above, in world XZ (yaw applied, tilt ignored).
static func footprint(o: Dictionary) -> PackedVector2Array:
	var local := PackedVector2Array()
	if str(o.get("type")) == "led_wall":
		local = column_edges(o)
	else:
		var w := size_m(o).x
		local = PackedVector2Array([Vector2(-w / 2.0, 0.0), Vector2(w / 2.0, 0.0)])
	var out := PackedVector2Array()
	for p in local:
		out.append(_to_world_xz(o, Vector3(p.x, 0.0, p.y)))
	return out


## Front elevation box in world units: x = left edge, y = bottom height, size = (projected width, height).
static func front_rect(o: Dictionary) -> Rect2:
	var fp := footprint(o)
	var lo := INF
	var hi := -INF
	for p in fp:
		lo = minf(lo, p.x)
		hi = maxf(hi, p.x)
	return Rect2(lo, float(o.position[1]), maxf(hi - lo, 0.01), size_m(o).y)


## Projector position in world XZ (projection objects).
static func projector_world_xz(o: Dictionary) -> Vector2:
	return _to_world_xz(o, projector_offset(o))


static func _to_world_xz(o: Dictionary, local: Vector3) -> Vector2:
	var w := local.rotated(Vector3.UP, deg_to_rad(float(o.rotation[1])))
	return Vector2(float(o.position[0]) + w.x, float(o.position[2]) + w.z)


## WO-614 T5 — ready-made layouts. Each returns NEW objects (ids unique against `existing`).
const TEMPLATES := {
	"three_walls": "Centre LED + 2 angled side walls (one canvas, carved L|C|R)",
	"imag_lr": "Two IMAG projection screens L/R",
	"tv_row": "Row of 4 × 55\" TVs",
}


## `raster` = the role's picture size; crops are fitted into it (canvas layouts keep their proportions).
static func template(name: String, existing: Array = [], role := "pgm1", raster := Vector2i(1920, 1080)) -> Array:
	var out: Array = []
	var all := existing.duplicate()
	var full := {"x": 0, "y": 0, "w": raster.x, "h": raster.y}
	match name:
		"three_walls":
			# 128 px / 500 mm panels: centre 12×6 = 1536×768 (6×3 m), sides 4×6 = 512×768 (2×3 m) → one 2560×768 canvas
			var specs := [["Side L", [4, 6], [-4.6, 0.5, 0.9], 20.0, 0], ["Centre LED", [12, 6], [0.0, 0.5, 0.0], 0.0, 512], ["Side R", [4, 6], [4.6, 0.5, 0.9], -20.0, 2048]]
			for s in specs:
				var o := new_object("led_wall", all)
				o["name"] = s[0]
				o["panel_px"] = [128, 128]
				o["panels"] = s[1]
				o["position"] = s[2]
				o["rotation"] = [0.0, s[3], 0.0]
				# design canvas 2560×768 scaled into the raster (proportions kept, left-aligned)
				var k := minf(float(raster.x) / 2560.0, float(raster.y) / 768.0)
				var x0 := roundi(int(s[4]) * k)
				var x1 := roundi((int(s[4]) + 128 * int(s[1][0])) * k)
				o["source"] = {"role": role, "rect": {"x": x0, "y": 0, "w": x1 - x0, "h": roundi(768 * k)}}
				o = normalize(o)
				out.append(o)
				all.append(o)
		"imag_lr":
			for side in [-1.0, 1.0]:
				var o := new_object("projection", all)
				o["name"] = "IMAG %s" % ("L" if side < 0 else "R")
				o["screen_m"] = [4.0, 2.25]
				o["position"] = [side * 7.5, 1.5, 1.0]
				o["rotation"] = [0.0, -side * 15.0, 0.0]
				o["throw"] = 1.6
				o["source"] = {"role": role, "rect": full.duplicate()}
				o = normalize(o)
				out.append(o)
				all.append(o)
		"tv_row":
			var first := new_object("tv", all)
			first["name"] = "TV 1"
			first["diagonal_in"] = 55.0
			first["resolution"] = [1920, 1080]
			first["position"] = [-1.95 * 1.5, 1.2, 3.0]
			first["source"] = {"role": role, "rect": full.duplicate()}
			first = normalize(first)
			out.append(first)
			all.append(first)
			out.append_array(array_copies(first, 3, 0.7, all))
	return out


## `count` copies of `o` side by side along its own X axis (yaw respected), `gap_m` apart.
static func array_copies(o: Dictionary, count: int, gap_m: float, existing: Array = []) -> Array:
	var out: Array = []
	var all := existing.duplicate()
	if not all.has(o):
		all.append(o)
	var step := size_m(o).x + gap_m
	var dir := Vector3.RIGHT.rotated(Vector3.UP, deg_to_rad(float(o.rotation[1])))
	var base_name := str(o.name).trim_suffix(" 1")
	for i in range(1, count + 1):
		var c: Dictionary = o.duplicate(true)
		c["id"] = new_object(str(o.type), all).id
		c["name"] = "%s %d" % [base_name, i + 1]
		var p := Vector3(o.position[0], o.position[1], o.position[2]) + dir * step * i
		c["position"] = [snappedf(p.x, 0.001), snappedf(p.y, 0.001), snappedf(p.z, 0.001)]
		c = normalize(c)
		out.append(c)
		all.append(c)
	return out
