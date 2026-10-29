extends Node
## WO-599 — settings mirror (client/lib/settings-state.js): GET /api/settings; changes are merged
## locally and saved with a 600 ms debounce (the web client has no Save button — same UX). Persisted
## server-side in highascg.config.json. WO-608: only the top-level sections changed since the last save
## are posted (core/settings_payload.gd says why).

signal loaded
signal changed
signal saved(ok: bool, info: Dictionary)  # info: the server's {sideEffects, warnings} or {error}

const NetUtil := preload("res://core/net_util.gd")
const ApiScript := preload("res://core/api.gd")
const Payload := preload("res://core/settings_payload.gd")

const SAVE_DEBOUNCE_S := 0.6

var api: ApiScript = null  # WO-732 P3b / WO-802: core/devices_target.gd's copy reads an edited linked server through this one; null = Api
var settings: Dictionary = {}
var is_loaded := false
var _save_timer: Timer
var _dirty := {}  # top-level keys changed since the last save


func _ready() -> void:
	_save_timer = Timer.new()
	_save_timer.one_shot = true
	_save_timer.wait_time = SAVE_DEBOUNCE_S
	_save_timer.timeout.connect(_flush)
	add_child(_save_timer)


func load_from_server() -> bool:
	var res: Dictionary = await _api().get_json("/api/settings")
	if not res.ok or not (res.data is Dictionary):
		return false
	var fresh: Dictionary = res.data
	for k in _dirty:  # an edit made while the GET was in flight is not lost
		if settings.has(k):
			fresh[k] = settings[k]
	settings = fresh
	is_loaded = true
	loaded.emit()
	changed.emit()
	return true


func get_setting(path: String, fallback: Variant = null) -> Variant:
	return Store.read_path(settings, path, fallback)


## Merge `partial` (nested dictionaries merge, other values replace) and schedule a save.
func patch(partial: Dictionary) -> void:
	NetUtil.deep_merge(settings, partial)
	for k in partial:
		_dirty[k] = true
	changed.emit()
	_save_timer.start()


func _flush() -> void:
	var keys := _dirty.keys()
	_dirty.clear()
	var body := Payload.build(settings, keys)
	if body.is_empty():
		return
	var res: Dictionary = await _api().post_json("/api/settings", body)
	if not res.ok:
		for k in keys:
			_dirty[k] = true  # retried with the next change
		push_warning("[Settings] save failed: %s" % res.error)
		saved.emit(false, {"error": str(res.error)})
		return
	saved.emit(true, res.data if res.data is Dictionary else {})
	if _dirty.is_empty() and _save_timer.is_stopped():
		await load_from_server()  # the server's normalised values (web settingsState.load after a save)


func _api() -> ApiScript:
	return api if api else Api
