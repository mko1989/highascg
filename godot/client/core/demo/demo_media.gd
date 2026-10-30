extends RefCounted
## WO-865 — the demo's media pictures, split out of demo_video.gd (WO-815 phase 2): the generated JPEG per picture media
## (res://demo/thumbs.json, tools/demo/build-demo-extras.py + add-demo-videos.py), their decoded Images, which media have
## a real video stream in the data set (Ogg Theora, res://demo/<name>.ogv) and the media list's type / length.

const THUMBS := "res://demo/thumbs.json"

static var _b64: Variant = null  # media id → base64 JPEG (loaded once)
static var _images := {}  # media id → Image (RGBA8), or null when it has no still


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


## "demo/placeholder_clip.ogv" → "res://demo/placeholder_clip.ogv" when that file ships; "" for every synthetic stand-in.
static func stream_for(media_id: String) -> String:
	if not media_id.begins_with("demo/") or not media_id.ends_with(".ogv"):
		return ""
	var p := "res://" + media_id
	return p if ResourceLoader.exists(p) else ""


## {type: "MOVIE" | "STILL" | "AUDIO" | "", durationMs} of a media id from the state's media list.
static func info(state: Dictionary, media_id: String) -> Dictionary:
	for m in (state.get("media", []) as Array) if state.get("media") is Array else []:
		if m is Dictionary and str(m.get("id", "")) == media_id:
			return {"type": str(m.get("type", "")), "durationMs": int(m.get("durationMs", 0))}
	return {"type": "", "durationMs": 0}
