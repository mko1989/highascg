extends Node
## WO-603 — "download to this computer" (web attachMediaModifierClick; here the media tree's right-click menu,
## GET /api/local-media/<id>/file). A save dialog picks the place; the body streams straight to disk
## (HTTPRequest.download_file — HAP clips are GBs, never buffered), with a progress line and cancel.

signal line(text: String)

var _http: HTTPRequest
var _tick: Timer
var _dest := ""
var _name := ""


static func file_url(id: String) -> String:
	return "/api/local-media/%s/file" % id.uri_encode()


static func progress_text(name: String, got: int, total: int) -> String:
	var mb := func(b: int) -> String: return "%.0f MB" % (b / 1048576.0) if b >= 10485760 else "%.1f MB" % (b / 1048576.0)
	if total > 0:
		return "Downloading %s… %d%% (%s of %s)" % [name, int(100.0 * got / total), mb.call(got), mb.call(total)]
	return "Downloading %s… %s" % [name, mb.call(got)]


## No XDG downloads dir configured (the box: Godot answers $HOME) → ~/Downloads when it exists.
static func downloads_dir(system: String, home: String) -> String:
	if (system == "" or system.trim_suffix("/") == home.trim_suffix("/")) and home != "" and DirAccess.dir_exists_absolute(home.path_join("Downloads")):
		return home.path_join("Downloads")
	return system if system != "" else home


func active() -> bool:
	return _http != null


## Ask where, then stream. `id` is the media-root path ("folder/clip.mov"); `origin` the server (Config.origin).
func ask(id: String, origin: String) -> void:
	if active():
		line.emit("A download is already running — ✕ cancels it")
		return
	var dlg := FileDialog.new()
	dlg.file_mode = FileDialog.FILE_MODE_SAVE_FILE
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.title = "Download to this computer"
	dlg.current_dir = downloads_dir(OS.get_system_dir(OS.SYSTEM_DIR_DOWNLOADS), OS.get_environment("HOME"))
	dlg.current_file = id.get_file()
	dlg.size = Vector2i(760, 480)
	dlg.file_selected.connect(func(path: String) -> void:
		dlg.queue_free()
		_start(origin + file_url(id), path))
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()


func cancel() -> void:
	if not active():
		return
	_http.cancel_request()
	_finish("✗ Download cancelled — %s" % _name, false)


func _start(url: String, path: String) -> void:
	_dest = path
	_name = path.get_file()
	_http = HTTPRequest.new()
	_http.use_threads = true
	_http.timeout = 0.0
	_http.download_file = path
	add_child(_http)
	_http.request_completed.connect(func(result: int, code: int, _h: PackedStringArray, _b: PackedByteArray) -> void:
		if result == HTTPRequest.RESULT_SUCCESS and code >= 200 and code < 300:
			_finish("✓ Saved %s to %s" % [_name, _dest.get_base_dir()], true)
		else:
			_finish("✗ Download failed — %s" % ("HTTP %d" % code if code > 0 else "network error %d" % result), false))
	_tick = Timer.new()
	_tick.wait_time = 0.5
	_tick.timeout.connect(func() -> void: line.emit(progress_text(_name, _http.get_downloaded_bytes(), _http.get_body_size())))
	add_child(_tick)
	_tick.start()
	var err := _http.request(url)
	if err != OK:
		_finish("✗ Download failed — %s" % error_string(err), false)
		return
	line.emit(progress_text(_name, 0, -1))


func _finish(text: String, ok: bool) -> void:
	if _tick != null:
		_tick.queue_free()
		_tick = null
	if _http != null:
		_http.queue_free()
		_http = null
	if not ok and _dest != "" and FileAccess.file_exists(_dest):
		DirAccess.remove_absolute(_dest)  # never leave a half file that looks like the clip
	line.emit(text)
