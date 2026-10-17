extends RefCounted
## WO-596 adapter: the native HshmSource (GDExtension, mmap + memcpy) behind the same interface as
## shm_reader.gd, so the HUD/stats/modes do not care which reader runs. The frame never passes through
## GDScript — shm_texture.gd calls src.upload_to(rid) on the render thread.

var src: RefCounted  # HshmSource (instantiated via ClassDB so this file parses without the extension)
var path: String
var native := true


func _init(segment_path: String) -> void:
	path = segment_path
	src = ClassDB.instantiate("HshmSource")
	src.call("open", segment_path)


static func available() -> bool:
	return ClassDB.class_exists("HshmSource")


func poll() -> bool:
	return src.call("poll")


var width: int:
	get: return src.call("get_width")
var height: int:
	get: return src.call("get_height")
var fps: float:
	get: return src.call("get_fps")
var frame_number: int:
	get: return src.call("get_frame_number")
var frames: int:
	get: return src.call("get_frames")
var gaps: int:
	get: return src.call("get_gaps")
var lapped: int:
	get: return src.call("get_lapped")
var reopens: int:
	get: return src.call("get_reopens")
var signal_lost: bool:
	get: return src.call("is_signal_lost")
var latency_ms: float:
	get: return src.call("get_latency_ms")
var read_ms: float:
	get: return src.call("get_read_ms")


func writer_dropped() -> int:
	return src.call("get_writer_dropped")
