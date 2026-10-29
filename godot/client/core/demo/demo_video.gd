extends RefCounted
## WO-815 phase 2 — the simulated server's pictures. The data set's res://demo/thumbs.json holds one generated JPEG per
## picture media (tools/demo/build-demo-extras.py); from it:
##   - GET /api/thumbnail/<media id> answers those bytes (core/demo/demo_server.gd get_bytes), so look cards draw their
##     layers like on a box (features/live/look_thumb.gd);
##   - an instance is the VideoSurfaces reader of a role (pgm1 / prv1 / … / chN) in a demo: the look the simulated
##     server has on that channel (`scene.live[ch].scene`) composited from the same stills with the look cards' own
##     placement (look_thumb_math.gd: FILL rect, crop, contain / cover / stretch), black when the bus is empty;
##   - the operator surface ("opgui"): the operator channel as Caspar composes it — each PGM / PRV window of the
##     compose layout (POST /api/operator-gui/layout, kept by demo_scene.gd) holds its bus's still, fitted to the
##     bus aspect like compose_tiles.gd draws its frame (compose_tile_math.gd fit / source_aspect).
## Same face as video_feed.gd's RoleReader (poll / frame / width / height / signal_lost, RGBA8 → update_rgba). A still
## per look, not video: it changes on a take / PRV push / clear / FTB. Opacity, rotation and timeline layers are not
## drawn.

const TM := preload("res://features/live/look_thumb_math.gd")
const CTM := preload("res://features/live/compose_tile_math.gd")
const OPERATOR := "opgui"
const THUMBS := "res://demo/thumbs.json"
const STILL_W := 960  # the look cards' SCENE_THUMB_MAX_W

static var _b64: Variant = null  # media id → base64 JPEG (loaded once)
static var _images := {}  # media id → Image (RGBA8), or null when it has no still

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


## The generated JPEG of a media id, or empty (audio, templates, unknown ids).
static func thumb_bytes(media_id: String) -> PackedByteArray:
	if _b64 == null:
		var v: Variant = JSON.parse_string(FileAccess.get_file_as_string(THUMBS))
		_b64 = (v as Dictionary).get("thumbs", {}) if v is Dictionary else {}
	var s: Variant = (_b64 as Dictionary).get(media_id)
	return Marshalls.base64_to_raw(s) if s is String and s != "" else PackedByteArray()


static func thumb_image(media_id: String) -> Image:
	if not _images.has(media_id):
		var b := thumb_bytes(media_id)
		var img: Image = null
		if not b.is_empty():
			img = Image.new()
			if img.load_jpg_from_buffer(b) == OK:
				img.convert(Image.FORMAT_RGBA8)
			else:
				img = null
		_images[media_id] = img
	return _images[media_id]


## A look's still at w × h: its layers bottom → top, each media still where the look card would draw it.
static func look_still(look: Dictionary, w: int, h: int) -> Image:
	var canvas := Image.create_empty(w, h, false, Image.FORMAT_RGBA8)
	canvas.fill(Color.BLACK)
	var size := Vector2(w, h)
	for l in TM.sorted_layers(look):
		var src: Variant = l.get("source")
		var t := str(src.get("type", "")).to_lower() if src is Dictionary else ""
		if (t != "media" and t != "file") or (l.get("opacity") != null and float(l.opacity) <= 0.0):
			continue
		var img := thumb_image(str(src.get("value", "")))
		if img == null:
			continue
		var at := TM.placement(l, size, Vector2(img.get_size()))
		if at.is_empty():
			continue
		var s_rect: Rect2 = at.src
		var sr := Rect2i(Vector2i(s_rect.position.floor()), Vector2i(s_rect.size.ceil())).intersection(Rect2i(Vector2i.ZERO, img.get_size()))
		var d: Rect2 = at.dst
		var dw := maxi(1, roundi(d.size.x))
		var dh := maxi(1, roundi(d.size.y))
		if sr.size.x <= 0 or sr.size.y <= 0:
			continue
		var part := img.get_region(sr)
		part.resize(dw, dh, Image.INTERPOLATE_BILINEAR)
		canvas.blend_rect(part, Rect2i(0, 0, dw, dh), Vector2i(roundi(d.position.x), roundi(d.position.y)))
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


static func _entry_key(e: Dictionary) -> String:
	return "%s@%s" % [str(e.get("sceneId", "")), str(e.get("updatedAt", ""))]


## The operator canvas size: the operator GUI destination's (1920 × 1080 when there is none).
static func operator_size(s: RefCounted) -> Vector2i:
	var sd: Variant = s.state.get("screenDestinations")
	for d in ((sd as Dictionary).get("destinations", []) if sd is Dictionary and sd.get("destinations") is Array else []):
		if d is Dictionary and str(d.get("mode", "")) == "operator_gui" and int(d.get("width", 0)) > 0 and int(d.get("height", 0)) > 0:
			return Vector2i(int(d.width), int(d.height))
	return Vector2i(1920, 1080)


## The operator channel: black, each PGM / PRV window with its bus's still at its picture rect.
static func operator_still(s: RefCounted, w: int, h: int) -> Image:
	var canvas := Image.create_empty(w, h, false, Image.FORMAT_RGBA8)
	canvas.fill(Color.BLACK)
	var cm: Variant = s.state.get("channelMap")
	for c in s.op_cells:
		var r := str(c.get("role", ""))
		var ch := role_channel("%s%d" % [r, int(c.get("mainIndex", 0)) + 1], cm) if r in ["pgm", "prv"] else 0
		if ch <= 0 or not (c.get("rect") is Dictionary):
			continue
		var pic := CTM.fit(CTM.to_px(c.rect, Vector2(w, h)), CTM.source_aspect(c, cm))
		var pw := roundi(pic.size.x)
		var ph := roundi(pic.size.y)
		if pw < 1 or ph < 1:
			continue
		var e := live_entry(s, ch)
		var still := look_still(e.get("scene") if e.get("scene") is Dictionary else {}, pw, ph)
		canvas.blit_rect(still, Rect2i(0, 0, pw, ph), Vector2i(roundi(pic.position.x), roundi(pic.position.y)))
	return canvas


## → true when a new frame is ready (the bus — or for the operator surface, a window or any of its buses — changed).
func poll() -> bool:
	var cm: Variant = server.state.get("channelMap")
	if role == OPERATOR:
		signal_lost = false
		var parts := [str(server.op_cells)]
		for c in server.op_cells:
			var r := str(c.get("role", ""))
			if r in ["pgm", "prv"]:
				parts.append(_entry_key(live_entry(server, role_channel("%s%d" % [r, int(c.get("mainIndex", 0)) + 1], cm))))
		return _draw("|".join(parts), operator_size(server), func(sz: Vector2i) -> Image: return operator_still(server, sz.x, sz.y))
	var ch := role_channel(role, cm)
	signal_lost = ch <= 0
	if signal_lost:
		return false
	var e := live_entry(server, ch)
	return _draw("%d|%s" % [ch, _entry_key(e)], still_size(cm, ch), func(sz: Vector2i) -> Image:
		return look_still(e.get("scene") if e.get("scene") is Dictionary else {}, sz.x, sz.y))


func _draw(key: String, sz: Vector2i, make: Callable) -> bool:
	if key == _key:
		return false
	_key = key
	var img: Image = make.call(sz)
	width = sz.x
	height = sz.y
	frame = img.get_data()
	return true
