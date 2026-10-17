extends Node
## WO-599 — settings mirror (client/lib/settings-state.js): GET /api/settings; changes are merged
## locally and saved as the WHOLE object with a 600 ms debounce (the web client has no Save button —
## same UX). Persisted server-side in highascg.config.json.

signal loaded
signal changed

const NetUtil := preload("res://core/net_util.gd")

const SAVE_DEBOUNCE_S := 0.6

var settings: Dictionary = {}
var is_loaded := false
var _save_timer: Timer


func _ready() -> void:
	_save_timer = Timer.new()
	_save_timer.one_shot = true
	_save_timer.wait_time = SAVE_DEBOUNCE_S
	_save_timer.timeout.connect(_flush)
	add_child(_save_timer)


func load_from_server() -> bool:
	var res: Dictionary = await Api.get_json("/api/settings")
	if not res.ok or not (res.data is Dictionary):
		return false
	settings = res.data
	is_loaded = true
	loaded.emit()
	changed.emit()
	return true


func get_setting(path: String, fallback: Variant = null) -> Variant:
	return Store.read_path(settings, path, fallback)


## Merge `partial` (nested dictionaries merge, other values replace) and schedule a save.
func patch(partial: Dictionary) -> void:
	NetUtil.deep_merge(settings, partial)
	changed.emit()
	_save_timer.start()


func _flush() -> void:
	var res: Dictionary = await Api.post_json("/api/settings", settings)
	if not res.ok:
		push_warning("[Settings] save failed: %s" % res.error)
