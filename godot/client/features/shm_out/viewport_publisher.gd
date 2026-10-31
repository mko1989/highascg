extends Node
## WO-743 (WO-738 step 2): publishes a SubViewport into a HighAsCG shm ring, which Caspar plays as a layer with
## PLAY <ch>-<layer> SHM NAME <name> (WO-742). Readback is asynchronous on RenderingDevice renderers (one frame of
## latency, no stall) and falls back to Image readback on Compatibility. At most MAX_IN_FLIGHT readbacks are pending
## (a readback lands a frame later, so one alone would halve the rate); beyond that a frame is skipped, never queued.
## Not wired into the client yet (that is WO-738 step 3); needs libhshm_sink (godot/extensions/hshm, WO-743). Without
## it start() returns an error and nothing else happens. Detach: delete this folder (WO-743 "How to remove").

var viewport: SubViewport
var sink: RefCounted  # HshmSink, created through ClassDB so this file parses where the extension is missing
var skipped := 0
const MAX_IN_FLIGHT := 2

var _in_flight := 0
var _rd: RenderingDevice
var _fps := 50


static func available() -> bool:
	return ClassDB.class_exists("HshmSink")


## Opens /dev/shm/highascg-<ring_name> at the viewport's size. Returns "" or the reason it could not.
func start(vp: SubViewport, ring_name: String, fps := 50) -> String:
	stop()
	if not available():
		return "libhshm_sink is not loaded"
	viewport = vp
	_fps = fps
	sink = ClassDB.instantiate("HshmSink")
	if not sink.open(ring_name, vp.size.x, vp.size.y, fps):
		var err: String = sink.get_error()
		sink = null
		return err
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_rd = RenderingServer.get_rendering_device()
	return ""


## Unlinks the ring: Caspar's layer holds the last frame (WO-742).
func stop() -> void:
	if sink != null:
		sink.close()
	sink = null
	viewport = null


func _process(_delta: float) -> void:
	if sink == null or viewport == null:
		return
	if viewport.size != Vector2i(sink.get_width(), sink.get_height()):
		var err := start(viewport, sink.get_name(), _fps)  # resized: re-open (same rate), Caspar picks up the new geometry
		if err != "":
			push_warning("shm_out: %s" % err)
		return
	if _in_flight >= MAX_IN_FLIGHT:
		skipped += 1
		return
	if _rd == null:
		sink.publish_image(viewport.get_texture().get_image(), false)
		return
	var tex := RenderingServer.texture_get_rd_texture(viewport.get_texture().get_rid())
	_in_flight += 1
	RenderingServer.call_on_render_thread(func() -> void: _rd.texture_get_data_async(tex, 0, _on_data))


# Viewport pixels arrive premultiplied: canvas items blend over the transparent clear with ONE / ONE_MINUS_SRC_ALPHA
# on alpha, so RGB is already colour × alpha (measured in tools/e2e/godot-shm-writer.sh).
func _on_data(data: PackedByteArray) -> void:
	_in_flight -= 1
	if sink != null:
		sink.publish_rgba8(data, false)
