extends RefCounted
## WO-815 phase 2 — the simulated server's pictures; WO-865 — now moving ones. The data set's res://demo/thumbs.json holds
## one generated JPEG per picture media (demo_media.gd); from it:
##   - GET /api/thumbnail/<media id> answers those bytes (core/demo/demo_server.gd get_bytes), so look cards draw their
##     layers like on a box (features/live/look_thumb.gd);
##   - an instance is the VideoSurfaces reader of a role (pgm1 / prv1 / … / chN) in a demo and its CPU face: the bus the
##     simulated server has on that channel (demo_bus.gd: the look in `scene.live[ch]`, layer opacity / placement, the
##     take's fade) rasterised from the stills; black when the bus is empty;
##   - the operator surface ("opgui"): the operator channel as Caspar composes it — each PGM / PRV window of the compose
##     layout (POST /api/operator-gui/layout, kept by demo_scene.gd) holds its bus's picture, fitted to the bus aspect like
##     compose_tiles.gd draws its frame (compose_tile_math.gd fit / source_aspect).
## Same face as video_feed.gd's RoleReader (poll / frame / width / height / signal_lost, RGBA8). In the running client the
## pictures are drawn by the GPU instead (demo_stage.gd, textures straight from SubViewports: motion, video clips, 30 fps in
## a browser) and this reader only answers `signal_lost`; without a scene tree (headless, tests) `poll()` is the way to a
## frame. It redraws when the bus changes or a transition moves, not for the synthetic motion (a shader effect).

const Bus := preload("res://core/demo/demo_bus.gd")
const Media := preload("res://core/demo/demo_media.gd")
const CTM := preload("res://features/live/compose_tile_math.gd")
const OPERATOR := "opgui"
const STILL_W := 960  # the look cards' SCENE_THUMB_MAX_W

var role := ""
var server: RefCounted  # core/demo/demo_server.gd
var frame := PackedByteArray()
var width := 0
var height := 0
var signal_lost := true
var _key := "?"


func _init(role_: String, server_: RefCounted) -> void:
	role = role_
	server = server_


static func thumb_bytes(media_id: String) -> PackedByteArray:
	return Media.thumb_bytes(media_id)


static func thumb_image(media_id: String) -> Image:
	return Media.thumb_image(media_id)


## A look's still at w × h: its layers bottom → top, each media still where the look card would draw it.
static func look_still(look: Dictionary, w: int, h: int) -> Image:
	return raster(Bus.settled_items(look, Vector2i(w, h)), w, h, Vector2i(w, h))


## Draw items (demo_bus.gd frame) bus-sized `bus_size` onto a w × h black canvas: each still scaled to its dst, faded by its
## alpha, in order. No rotation, clip or motion (the GPU path has them).
static func raster(items: Array, w: int, h: int, bus_size: Vector2i) -> Image:
	var canvas := Image.create_empty(w, h, false, Image.FORMAT_RGBA8)
	canvas.fill(Color.BLACK)
	var k := Vector2(w, h) / Vector2(bus_size)
	for it in items:
		var img: Image = it.img
		var s_rect: Rect2 = it.src
		var sr := Rect2i(Vector2i(s_rect.position.floor()), Vector2i(s_rect.size.ceil())).intersection(Rect2i(Vector2i.ZERO, img.get_size()))
		var d: Rect2 = it.dst
		var dw := maxi(1, roundi(d.size.x * k.x))
		var dh := maxi(1, roundi(d.size.y * k.y))
		if sr.size.x <= 0 or sr.size.y <= 0:
			continue
		var part := img.get_region(sr)
		part.resize(dw, dh, Image.INTERPOLATE_BILINEAR)
		var a := float(it.alpha)
		if a < 0.999:
			var px := part.get_data()
			for i in range(3, px.size(), 4):
				px[i] = int(px[i] * a)
			part = Image.create_from_data(dw, dh, false, Image.FORMAT_RGBA8, px)
		canvas.blend_rect(part, Rect2i(0, 0, dw, dh), Vector2i(roundi(d.position.x * k.x), roundi(d.position.y * k.y)))
	return canvas


## src/system/video-surfaces.js resolveRoleChannel: pgmN / prvN → the main's PGM / PRV channel (a PGM-only main has no
## PRV), chN → channel N; anything else (inN, the operator surface) → 0.
static func role_channel(r: String, cm: Variant) -> int:
	var m := RegEx.create_from_string("^(pgm|prv)([1-4])$").search(r)
	if m != null and cm is Dictionary:
		var idx := m.get_string(2).to_int() - 1
		var pgm: Array = cm.get("programChannels", []) if cm.get("programChannels") is Array else []
		var prv: Array = cm.get("previewChannels", []) if cm.get("previewChannels") is Array else []
		var list := pgm if m.get_string(1) == "pgm" else prv
		if idx >= list.size() or list[idx] == null:
			return 0
		if m.get_string(1) == "prv" and idx < pgm.size() and pgm[idx] != null and int(pgm[idx]) == int(list[idx]):
			return 0
		return int(list[idx])
	var c := RegEx.create_from_string("^ch(\\d+)$").search(r)
	return c.get_string(1).to_int() if c != null else 0


## The still's size for a channel: its resolution (channelResolutionsByChannel) scaled to STILL_W wide.
static func still_size(cm: Variant, ch: int) -> Vector2i:
	var res: Variant = (cm.get("channelResolutionsByChannel", {}) as Dictionary).get(str(ch)) if cm is Dictionary and cm.get("channelResolutionsByChannel") is Dictionary else null
	var rw := float(res.get("w", 1920)) if res is Dictionary else 1920.0
	var rh := float(res.get("h", 1080)) if res is Dictionary else 1080.0
	return Vector2i(STILL_W, maxi(1, roundi(STILL_W * rh / maxf(rw, 1.0))))


## The `scene.live` entry of a channel ({sceneId, scene, updatedAt}), or {}.
static func live_entry(s: RefCounted, ch: int) -> Dictionary:
	var live: Variant = (s.state.get("scene", {}) as Dictionary).get("live") if s.state.get("scene") is Dictionary else null
	var e: Variant = (live as Dictionary).get(str(ch)) if live is Dictionary else null
	return e if e is Dictionary else {}


## The operator canvas size: the operator GUI destination's (1920 × 1080 when there is none).
static func operator_size(s: RefCounted) -> Vector2i:
	var sd: Variant = s.state.get("screenDestinations")
	for d in ((sd as Dictionary).get("destinations", []) if sd is Dictionary and sd.get("destinations") is Array else []):
		if d is Dictionary and str(d.get("mode", "")) == "operator_gui" and int(d.get("width", 0)) > 0 and int(d.get("height", 0)) > 0:
			return Vector2i(int(d.width), int(d.height))
	return Vector2i(1920, 1080)


## The picture rect of a compose cell on a `canvas`-px operator surface (compose_tiles.gd's frame), and its bus channel.
static func cell_picture(s: RefCounted, c: Dictionary, canvas: Vector2) -> Dictionary:
	var cm: Variant = s.state.get("channelMap")
	var r := str(c.get("role", ""))
	var ch := role_channel("%s%d" % [r, int(c.get("mainIndex", 0)) + 1], cm) if r in ["pgm", "prv"] else 0
	if ch <= 0 or not (c.get("rect") is Dictionary):
		return {}
	var pic := CTM.fit(CTM.to_px(c.rect, canvas), CTM.source_aspect(c, cm))
	return {} if roundi(pic.size.x) < 1 or roundi(pic.size.y) < 1 else {"channel": ch, "rect": pic}


## The operator channel: black, each PGM / PRV window with its bus's picture at its picture rect.
static func operator_still(s: RefCounted, w: int, h: int, now := 0.0) -> Image:
	var canvas := Image.create_empty(w, h, false, Image.FORMAT_RGBA8)
	canvas.fill(Color.BLACK)
	for c in s.op_cells:
		var cp := cell_picture(s, c, Vector2(w, h))
		if cp.is_empty():
			continue
		var pic: Rect2 = cp.rect
		var bus: RefCounted = s.bus(int(cp.channel), now)
		var pw := roundi(pic.size.x)
		var ph := roundi(pic.size.y)
		canvas.blit_rect(raster(bus.frame(now), pw, ph, bus.size), Rect2i(0, 0, pw, ph), Vector2i(roundi(pic.position.x), roundi(pic.position.y)))
	return canvas


## The GPU path draws the picture (demo_stage.gd); the reader only tells whether the role has a bus (the UI's "no signal").
func update_lost() -> void:
	signal_lost = role != OPERATOR and role_channel(role, server.state.get("channelMap")) <= 0


## → true when a new frame is ready (the bus, a window, or a fade in progress changed).
func poll(now := -1.0) -> bool:
	var t: float = server.clock() if now < 0.0 else now
	var cm: Variant = server.state.get("channelMap")
	if role == OPERATOR:
		signal_lost = false
		var parts := [str(server.op_cells)]
		var sz := operator_size(server)
		for c in server.op_cells:
			var cp := cell_picture(server, c, Vector2(sz))
			if not cp.is_empty():
				parts.append(_bus_sig(server.bus(int(cp.channel), t), t))
		return _draw("|".join(parts), sz, func(v: Vector2i) -> Image: return operator_still(server, v.x, v.y, t))
	var ch := role_channel(role, cm)
	signal_lost = ch <= 0
	if signal_lost:
		return false
	var bus: RefCounted = server.bus(ch, t)
	return _draw("%d|%s" % [ch, _bus_sig(bus, t)], bus.size, func(v: Vector2i) -> Image:
		return raster(bus.frame(t), v.x, v.y, bus.size))


static func _bus_sig(bus: RefCounted, now: float) -> String:
	return "%s|%d" % [bus.last_key(), roundi(bus.progress(now) * 200.0) if bus.in_transition(now) else 200]


func _draw(key: String, sz: Vector2i, make: Callable) -> bool:
	if key == _key:
		return false
	_key = key
	var img: Image = make.call(sz)
	width = sz.x
	height = sz.y
	frame = img.get_data()
	return true
