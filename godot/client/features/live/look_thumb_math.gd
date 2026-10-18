extends RefCounted
## WO-608 R5 — look deck card thumbnails, the pure part (web scenes-editor-deck-thumb.js + preview-canvas-draw-stacks.js
## `deckThumbnailMode`, lib/thumbnail-url.js `deckIdleMode`). Which URL a layer's thumbnail comes from, and where its
## image lands on the card: FILL rect, clipped to the crop window, contentZoom inflating the draw rect around its
## centre, then stretch / cover / contain like the web canvas.

const C := preload("res://features/live/compose_math.gd")

const CARD_W := 480  # web SCENE_CARD_THUMB_W
const MAX_W := 960   # web SCENE_THUMB_MAX_W


## Thumbnail path for a layer source on an idle deck card, or "" (templates, buses, NDI… draw a label instead).
## Media/file → GET /api/thumbnail/<id>; a DeckLink input route → the captured frame of that input channel (WO-392).
static func thumb_path(src: Variant, cm: Dictionary) -> String:
	if not (src is Dictionary) or str(src.get("value", "")) == "":
		return ""
	if src.get("isPlaceholder") == true or str(src.get("type", "")) == "placeholder":
		return ""
	var t := str(src.get("type", "")).to_lower()
	if t == "media" or t == "file":
		return "/api/thumbnail/%s?hq=1&w=%d&t=0" % [str(src.value).uri_encode(), MAX_W]
	if t != "route" and t != "live":
		return ""
	var ch := live_channel(src)
	if ch <= 0:
		return ""
	if str(src.get("routeType", "")).to_lower() != "decklink" and not is_decklink_input(cm, ch):
		return ""  # WO-63: never a full-bus PRINT still on an idle card
	return "/api/thumbnail/live/%d" % ch


static func live_channel(src: Dictionary) -> int:
	var v := str(src.get("value", ""))
	if src.get("useDirect") == true and v.strip_edges().to_lower().begins_with("ndi://"):
		return -1
	var m := RegEx.create_from_string("(?i)^route://(\\d+)").search(v)
	if m != null:
		return m.get_string(1).to_int()
	for k in ["thumbnailChannel", "liveThumbChannel", "producerChannel"]:
		if src.get(k) != null and int(src.get(k)) > 0:
			return int(src.get(k))
	return -1


static func is_decklink_input(cm: Dictionary, ch: int) -> bool:
	if cm.get("decklinkInputChannels") is Array:
		for c in cm.decklinkInputChannels:
			if int(c) == ch:
				return true
	for e in (cm.get("inputChannels", []) if cm.get("inputChannels") is Array else []):
		if e is Dictionary and str(e.get("kind", "")) == "decklink" and int(e.get("channel", -1)) == ch:
			return true
	return false


## Layers bottom → top (web sorts by layerNumber).
static func sorted_layers(look: Dictionary) -> Array:
	var out: Array = (look.get("layers", []) as Array).filter(func(l: Variant) -> bool: return l is Dictionary) if look.get("layers") is Array else []
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return int(a.get("layerNumber", 0)) < int(b.get("layerNumber", 0)))
	return out


## The layer's visible box on a W×H card: FILL rect ∩ its crop window (web fillToPixelRect + cropAdjustedRect).
static func visible_rect(layer: Dictionary, size: Vector2) -> Rect2:
	var r := fill_rect(layer, size)
	var c := crop_of(layer)
	if c.is_empty():
		return r
	return Rect2(r.position + Vector2(float(c.left), float(c.top)) * r.size,
		Vector2(float(c.right) - float(c.left), float(c.bottom) - float(c.top)) * r.size)


static func fill_rect(layer: Dictionary, size: Vector2) -> Rect2:
	var f: Dictionary = layer.get("fill", {}) if layer.get("fill") is Dictionary else {}
	return Rect2(Vector2(float(f.get("x", 0)), float(f.get("y", 0))) * size,
		Vector2(maxf(float(f.get("scaleX", 1)) * size.x, 1.0), maxf(float(f.get("scaleY", 1)) * size.y, 1.0)))


static func crop_of(layer: Dictionary) -> Dictionary:
	for fx in (layer.get("effects", []) if layer.get("effects") is Array else []):
		if fx is Dictionary and str(fx.get("type", "")) == "crop":
			var c := C.normalize_crop(fx.get("params"))
			return {} if C.is_identity_crop(c) else c
	return {}


## stretch | cover | contain — web: shader templates, contentFit 'stretch' or an unlocked aspect stretch;
## 'horizontal' / 'vertical' cover; native / fill-canvas contain.
static func fit_mode(layer: Dictionary) -> String:
	var cf := str(layer.get("contentFit", "native"))
	var v := str((layer.get("source", {}) as Dictionary).get("value", "")) if layer.get("source") is Dictionary else ""
	if RegEx.create_from_string("(?i)(^|/)shaders/").search(v) != null or cf == "stretch" \
			or layer.get("fillNativeAspect") == false or layer.get("aspectLocked") == false:
		return "stretch"
	if cf == "horizontal" or cf == "vertical":
		return "cover"
	return "contain"


## Where an image of `img` pixels is drawn for `layer` on a `size` card: {dst, src} (src in image pixels), already
## clipped to the visible box; {} when nothing is visible.
static func placement(layer: Dictionary, size: Vector2, img: Vector2) -> Dictionary:
	if img.x <= 0 or img.y <= 0:
		return {}
	var box := fill_rect(layer, size)
	var vis := visible_rect(layer, size).intersection(Rect2(Vector2.ZERO, size))
	var zm := float(layer.get("contentZoom", 1)) if layer.get("contentZoom") != null else 1.0
	if zm > 1.0:
		box = Rect2(box.position - box.size * (zm - 1.0) / 2.0, box.size * zm)
	var src := Rect2(Vector2.ZERO, img)
	var dst := box
	match fit_mode(layer):
		"cover":
			var br := box.size.x / box.size.y
			if img.x / img.y > br:
				src = Rect2(Vector2((img.x - img.y * br) / 2.0, 0), Vector2(img.y * br, img.y))
			else:
				src = Rect2(Vector2(0, (img.y - img.x / br) / 2.0), Vector2(img.x, img.x / br))
		"contain":
			var s := minf(box.size.x / img.x, box.size.y / img.y)
			dst = Rect2(box.position + (box.size - img * s) / 2.0, img * s)
	var d := dst.intersection(vis)
	if d.size.x <= 0.5 or d.size.y <= 0.5:
		return {}
	var k := src.size / dst.size
	return {"dst": d, "src": Rect2(src.position + (d.position - dst.position) * k, d.size * k)}
