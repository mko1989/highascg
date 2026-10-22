extends RefCounted
## WO-595 M0: one live texture per shm surface. RD path = Texture2DRD wrapping a BGRA8 RD texture
## updated with RenderingDevice.texture_update (the WO-596 design). Needs Forward+ or Mobile; the
## Compatibility renderer (and --headless) have no RenderingDevice → ImageTexture fallback with
## R/B swapped (diagnostics only).

var texture: Texture2D
var kind := "none"  # "rd-bgra" | "rd-rgba" (WO-670 JPEG feed) | "image-fallback"
var upload_ms := 0.0
var width := 0
var height := 0

var _rd: RenderingDevice
var _rid := RID()
var _image: Image
var _format := RenderingDevice.DATA_FORMAT_B8G8R8A8_UNORM


func _init() -> void:
	_rd = RenderingServer.get_rendering_device()
	if _rd != null:
		texture = Texture2DRD.new()
		kind = "rd-bgra"
	else:
		texture = ImageTexture.new()
		kind = "image-fallback"


func format_supported() -> bool:
	if _rd == null:
		return false
	var usage := RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT | RenderingDevice.TEXTURE_USAGE_CAN_UPDATE_BIT
	return _rd.texture_is_format_supported_for_usage(RenderingDevice.DATA_FORMAT_B8G8R8A8_UNORM, usage)


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
	if w != width or h != height or format != _format:
		width = w
		height = h
		_format = format
		kind = "rd-rgba" if format == RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM else "rd-bgra"
		RenderingServer.call_on_render_thread(_create.bind(w, h, data, format))
	else:
		RenderingServer.call_on_render_thread(_upload.bind(data))


## Native path (WO-596): the HshmSource uploads its own buffer on the render thread.
func update_native(src: RefCounted) -> void:
	if _rd == null:
		return  # headless / Compatibility: nothing to draw into
	var w: int = src.call("get_width")
	var h: int = src.call("get_height")
	if w <= 0 or h <= 0:
		return
	if w != width or h != height or _format != RenderingDevice.DATA_FORMAT_B8G8R8A8_UNORM:
		width = w
		height = h
		_format = RenderingDevice.DATA_FORMAT_B8G8R8A8_UNORM
		RenderingServer.call_on_render_thread(_create.bind(w, h, PackedByteArray(), _format))
	RenderingServer.call_on_render_thread(_upload_native.bind(src))


func _upload_native(src: RefCounted) -> void:
	if not _rid.is_valid():
		return
	src.call("upload_to", _rid)
	upload_ms = src.call("get_upload_ms")


func _create(w: int, h: int, data: PackedByteArray, format: int) -> void:
	if _rid.is_valid():
		_rd.free_rid(_rid)
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
	var rid := _rd.texture_create(fmt, RDTextureView.new(), initial)
	_rid = rid
	_assign.call_deferred(rid)


func _assign(rid: RID) -> void:
	(texture as Texture2DRD).texture_rd_rid = rid


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


func free_gpu() -> void:
	if _rd != null and _rid.is_valid():
		var rid := _rid
		_rid = RID()
		RenderingServer.call_on_render_thread(_rd.free_rid.bind(rid))
