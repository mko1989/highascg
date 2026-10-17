extends RefCounted
## WO-595 M0: rolling + total measurements for the HUD, periodic log lines and the final SUMMARY
## (paste the SUMMARY JSON into WO-595 "What was VERIFIED").

const WINDOW := 250  # samples (~5 s at 50 fps)

var started_ms := Time.get_ticks_msec()
var rendered := 0
var received := 0
var _frame_ms: Array[float] = []
var _read_ms: Array[float] = []
var _upload_ms: Array[float] = []
var _lat_ms: Array[float] = []
var _poll_ms: Array[float] = []
var _all_frame_ms: Array[float] = []
var _all_lat_ms: Array[float] = []
var _all_read_ms: Array[float] = []
var _all_upload_ms: Array[float] = []


func sample(delta: float, got: bool, reader, tex, poll_ms: float) -> void:
	rendered += 1
	_push(_frame_ms, delta * 1000.0)
	_all_frame_ms.append(delta * 1000.0)
	_push(_poll_ms, poll_ms)
	if got:
		received += 1
		_push(_read_ms, reader.read_ms)
		_push(_lat_ms, reader.latency_ms)
		_push(_upload_ms, tex.upload_ms)
		_all_lat_ms.append(reader.latency_ms)
		_all_read_ms.append(reader.read_ms)
		_all_upload_ms.append(tex.upload_ms)


func hud_text(mode: String, reader, tex) -> String:
	var lines := PackedStringArray()
	lines.append("M0 spike · mode %s · reader %s · %s · %s" % [mode, "native" if reader.get("native") == true else "gdscript", tex.kind, RenderingServer.get_video_adapter_name()])
	lines.append("surface %s" % reader.path)
	if reader.signal_lost:
		lines.append("NO SIGNAL (waiting for writer)")
	else:
		lines.append("%dx%d @ %.2f   frame #%d" % [reader.width, reader.height, reader.fps, reader.frame_number])
	lines.append("render fps %.1f   frame ms p50 %.2f p95 %.2f" % [
		Engine.get_frames_per_second(), _pct(_frame_ms, 0.5), _pct(_frame_ms, 0.95)])
	lines.append("read ms p50 %.2f p95 %.2f   upload ms p50 %.2f p95 %.2f" % [
		_pct(_read_ms, 0.5), _pct(_read_ms, 0.95), _pct(_upload_ms, 0.5), _pct(_upload_ms, 0.95)])
	lines.append("latency ms p50 %.2f p95 %.2f   (publish → read)" % [_pct(_lat_ms, 0.5), _pct(_lat_ms, 0.95)])
	lines.append("frames %d   gaps %d   lapped %d   writer dropped %d   reopens %d" % [
		reader.frames, reader.gaps, reader.lapped, reader.writer_dropped(), reader.reopens])
	lines.append("[1] canvas  [2] atlas  [3] previs  [F] fullscreen  [H] hud  [Esc] quit")
	return "\n".join(lines)


func log_line(mode: String, reader, tex) -> String:
	return "[m0] mode=%s fps=%.1f frame_ms_p95=%.2f read_ms_p50=%.2f upload_ms_p50=%.2f lat_ms_p50=%.2f frames=%d gaps=%d lapped=%d lost=%s" % [
		mode, Engine.get_frames_per_second(), _pct(_frame_ms, 0.95), _pct(_read_ms, 0.5), _pct(_upload_ms, 0.5),
		_pct(_lat_ms, 0.5), reader.frames, reader.gaps, reader.lapped, str(reader.signal_lost)]


func summary(mode: String, reader, tex) -> Dictionary:
	var secs := (Time.get_ticks_msec() - started_ms) / 1000.0
	return {
		"mode": mode,
		"renderer": RenderingServer.get_current_rendering_method(),
		"driver": RenderingServer.get_current_rendering_driver_name(),
		"adapter": RenderingServer.get_video_adapter_name(),
		"engine": Engine.get_version_info().string,
		"texture_path": tex.kind,
		"reader": "native" if reader.get("native") == true else "gdscript",
		"surface": "%dx%d@%.2f" % [reader.width, reader.height, reader.fps],
		"seconds": snappedf(secs, 0.01),
		"render_fps_avg": snappedf(rendered / max(secs, 0.001), 0.1),
		"frames_received": reader.frames,
		"gaps": reader.gaps,
		"lapped": reader.lapped,
		"frame_ms_p50": snappedf(_pct(_all_frame_ms, 0.5), 0.01),
		"frame_ms_p95": snappedf(_pct(_all_frame_ms, 0.95), 0.01),
		"frame_ms_max": snappedf(_pct(_all_frame_ms, 1.0), 0.01),
		"read_ms_p50": snappedf(_pct(_all_read_ms, 0.5), 0.01),
		"read_ms_p95": snappedf(_pct(_all_read_ms, 0.95), 0.01),
		"upload_ms_p50": snappedf(_pct(_all_upload_ms, 0.5), 0.01),
		"upload_ms_p95": snappedf(_pct(_all_upload_ms, 0.95), 0.01),
		"latency_ms_p50": snappedf(_pct(_all_lat_ms, 0.5), 0.01),
		"latency_ms_p95": snappedf(_pct(_all_lat_ms, 0.95), 0.01),
	}


func _push(arr: Array[float], v: float) -> void:
	arr.append(v)
	if arr.size() > WINDOW:
		arr.remove_at(0)


static func _pct(arr: Array[float], q: float) -> float:
	if arr.is_empty():
		return 0.0
	var s := arr.duplicate()
	s.sort()
	return s[min(s.size() - 1, int(q * s.size()))]
