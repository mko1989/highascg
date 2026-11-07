extends RefCounted
## WO-595 M0: one live texture per shm surface. RD path = Texture2DRD wrapping a BGRA8 RD texture
## updated with RenderingDevice.texture_update (the WO-596 design). Needs Forward+ or Mobile; the
## Compatibility renderer (and --headless) have no RenderingDevice → ImageTexture fallback with
## R/B swapped (diagnostics only).
##
## WO-997 lifetime: the RD texture is ours to free (free_gpu, called by the owner's PREDELETE). _rid and _retired
## are only touched on the render thread; a replaced texture stays alive until the Texture2DRD points at its
## successor, so nothing ever samples a freed RID.

var texture: Texture2D
var kind := "none"  # "rd-bgra" | "rd-rgba" (WO-670 JPEG feed) | "image-fallback"
var upload_ms := 0.0
var width := 0
var height := 0

var _rd: Object  # RenderingDevice (an Object so the lifetime test can hand in a counting fake)
var _rid := RID()
var _retired := {}  # successor RID → the RID it replaced, freed once the successor is attached
var _closed := false
var _image: Image
var _format := RenderingDevice.DATA_FORMAT_B8G8R8A8_UNORM
# Seams (tests swap them): queue on the render thread, queue on the main thread, point the Texture2DRD at a RID.
var _on_render := Callable(RenderingServer, &"call_on_render_thread")
var _on_main: Callable
var _attach: Callable


func _init() -> void:
	_on_main = func(c: Callable) -> void: c.call_deferred()
	_attach = func(rid: RID) -> void: (texture as Texture2DRD).texture_rd_rid = rid
	_rd = RenderingServer.get_rendering_device()
	if _rd != null:
		texture = Texture2DRD.new()
		kind = "rd-bgra"
	else:
		texture = ImageTexture.new()
		kind = "image-fallback"


func update(data: PackedByteArray, w: int, h: int) -> void:
	if data.size() < w * h * 4:
		return
	if _rd == null:
		_update_image(data, w, h)
		return
	_rd_update(data, w, h, RenderingDevice.DATA_FORMAT_B8G8R8A8_UNORM)


## WO-670 P1: RGBA8 frames (the remote JPEG feed, decoded by Image). Same Texture2D object; the RD texture is
## recreated in RGBA when the source switches. The image fallback is RGBA already, so colours are right there too.
func update_rgba(data: PackedByteArray, w: int, h: int) -> void:
	if data.size() < w * h * 4:
		return
	if _rd == null:
		_update_image(data, w, h)
		return
	_rd_update(data, w, h, RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM)


func _rd_update(data: PackedByteArray, w: int, h: int, format: int) -> void:
	if _closed:
		return
	if w != width or h != height or format != _format:
		width = w
		height = h
		_format = format
		kind = "rd-rgba" if format == RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM else "rd-bgra"
		_on_render.call(_create.bind(w, h, data, format))
	else:
		_on_render.call(_upload.bind(data))


## Native path (WO-596): the HshmSource uploads its own buffer on the render thread.
func update_native(src: RefCounted) -> void:
	if _rd == null or _closed:
		return  # headless / Compatibility: nothing to draw into
	var w: int = src.call("get_width")
	var h: int = src.call("get_height")
	if w <= 0 or h <= 0:
		return
	if w != width or h != height or _format != RenderingDevice.DATA_FORMAT_B8G8R8A8_UNORM:
		width = w
		height = h
		_format = RenderingDevice.DATA_FORMAT_B8G8R8A8_UNORM
		_on_render.call(_create.bind(w, h, PackedByteArray(), _format))
	_on_render.call(_upload_native.bind(src))


func _upload_native(src: RefCounted) -> void:
	if not _rid.is_valid():
		return
	src.call("upload_to", _rid)
	upload_ms = src.call("get_upload_ms")


## Render thread. The old texture is retired, not freed: the Texture2DRD still shows it until _swap re-points it.
func _create(w: int, h: int, data: PackedByteArray, format: int) -> void:
	if _closed:
		return  # free_gpu came first: making a texture now would leak it
	var fmt := RDTextureFormat.new()
	fmt.format = format
	fmt.width = w
	fmt.height = h
	fmt.usage_bits = (
		RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT
		| RenderingDevice.TEXTURE_USAGE_CAN_UPDATE_BIT
		| RenderingDevice.TEXTURE_USAGE_CAN_COPY_FROM_BIT
	)
	var initial: Array[PackedByteArray] = []
	if data.size() == w * h * 4:
		initial.append(data)
	var rid: RID = _rd.texture_create(fmt, RDTextureView.new(), initial)
	if _rid.is_valid():
		_retired[rid] = _rid
	_rid = rid
	_on_main.call(_swap.bind(rid))


## Main thread: show the new texture, then free the one it replaced. Texture2DRD applies the RID on the render
## thread too, so the free queued after it runs once nothing draws the old one.
func _swap(rid: RID) -> void:
	if _closed:
		return  # free_gpu's render-thread pass frees current and retired alike
	_attach.call(rid)
	_on_render.call(_reap.bind(rid))


func _reap(successor: RID) -> void:
	if _retired.has(successor):
		_rd.free_rid(_retired[successor])
		_retired.erase(successor)


func _upload(data: PackedByteArray) -> void:
	if not _rid.is_valid():
		return
	var t0 := Time.get_ticks_usec()
	_rd.texture_update(_rid, 0, data)
	upload_ms = (Time.get_ticks_usec() - t0) / 1000.0


func _update_image(data: PackedByteArray, w: int, h: int) -> void:
	var t0 := Time.get_ticks_usec()
	if _image == null or width != w or height != h:
		_image = Image.create_from_data(w, h, false, Image.FORMAT_RGBA8, data)
		(texture as ImageTexture).set_image(_image)
		width = w
		height = h
	else:
		_image.set_data(w, h, false, Image.FORMAT_RGBA8, data)
		(texture as ImageTexture).update(_image)
	upload_ms = (Time.get_ticks_usec() - t0) / 1000.0


## WO-997: release the RD texture (owners call this from PREDELETE). Detach first, then free on the render thread
## behind any _create/_upload still queued. The lambda holds this object, so a dropped ShmTexture lives until then.
func free_gpu() -> void:
	if _rd == null or _closed:
		return
	_closed = true
	_attach.call(RID())
	var me: RefCounted = self
	_on_render.call(func() -> void: me.call("_free_all"))


func _free_all() -> void:
	for rid: RID in _retired.values():
		_rd.free_rid(rid)
	_retired.clear()
	if _rid.is_valid():
		_rd.free_rid(_rid)
	_rid = RID()
