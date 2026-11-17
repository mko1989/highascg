extends Node
## WO-1039 — the device gallery for Programming (Backgrounds / Logos source tabs, stage backgrounds): the list from
## GET /api/pixelhue/studio/gallery, thumbnails from …/gallery/thumb?id=N (decoded once, cached), and rename / delete /
## capture via POST …/gallery/manage. Uploading a file is left out (WO-1039 rule 10).

signal notice(text: String)
signal changed()

const StudioApi := preload("res://features/pixelhue/studio_api.gd")
const M := preload("res://features/pixelhue/programming_model.gd")
const P := preload("res://features/pixelhue/programming_presets_model.gd")
const TIMEOUT_S := 120.0  # a capture waits for the device to convert the picture
const THUMB_SLOTS := 2  # WO-1106 C42: thumbnails one or two at a time, not all at once through the Api's 6-slot pool

var api_fn: Callable
var gallery: Dictionary = {}
var _loading := false
var _loaded := false  # WO-1106 C42: only a successful read counts; a failed one is tried again on the next load_once
var _thumbs := {}  # picture id → Texture2D, or an Array of callbacks while it loads
var _thumb_queue: Array[int] = []
var _thumb_running := 0


func load_once() -> void:
	if _loading or _loaded:
		return
	_loading = true
	var r: Dictionary = await StudioApi.read(api_fn.call(), "gallery")
	_loading = false
	_loaded = r.ok
	if r.ok:
		gallery = M.ints(r.data)
	else:
		if gallery.is_empty():
			gallery = {"pictures": [], "support": {}}
		notice.emit(r.error)
	changed.emit()


## → true when the device did it; `notice` carries Studio's words either way.
func manage(body: Dictionary, done: String) -> bool:
	notice.emit("Capturing…" if str(body.get("action")) == "capture" else "Updating gallery…")
	var r := StudioApi.shape(await api_fn.call().post_json(StudioApi.BASE + "gallery/manage", body, TIMEOUT_S))
	if r.ok:
		gallery = M.ints(r.data)
		_loaded = true
		_thumbs.clear()
	notice.emit(done if r.ok else r.error)
	changed.emit()
	return r.ok


## A thumbnail texture; `cb(tex)` runs once it is there (never for a picture the device cannot serve).
func thumb(id: int, cb: Callable) -> void:
	var have: Variant = _thumbs.get(id)
	if have is Texture2D:
		cb.call(have)
		return
	if have is Array:
		(have as Array).append(cb)
		return
	_thumbs[id] = [cb]
	_thumb_queue.append(id)
	_pump_thumbs()


func _pump_thumbs() -> void:
	while _thumb_running < THUMB_SLOTS and not _thumb_queue.is_empty():
		_fetch_thumb(_thumb_queue.pop_front())


func _fetch_thumb(id: int) -> void:
	_thumb_running += 1
	var r: Dictionary = await api_fn.call().get_bytes(StudioApi.BASE + "gallery/thumb?id=%d" % id)
	_thumb_running -= 1
	_pump_thumbs()
	var img: Image = P.decode_picture(r.get("bytes", PackedByteArray())) if r.get("ok") == true else null
	var waiting: Variant = _thumbs.get(id)
	if img == null:
		_thumbs.erase(id)
		return
	var tex := ImageTexture.create_from_image(img)
	_thumbs[id] = tex
	if waiting is Array:
		for w in waiting:
			(w as Callable).call(tex)
