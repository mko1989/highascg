extends Node
## WO-598/599 — the show-document write path, same protocol as the web client (client/app.js:164-301):
##   edit → mark_dirty() → 3 s debounce (flush now on request) → single-flight POST /api/project/autosave
##   {project} with the server-issued `rev`; 409 stale_rev → adopt storedRev and retry (≤ 3, last write
##   wins, like the web); 410 project_gone → stop autosaving; a CHANGED save is echoed back by the server
##   as project_sync → skip exactly one echo (client/lib/project-remote-sync.js latch).
## Two editors (web + Godot) on one show are therefore safe in the same way two web tabs are.
## ⚠ LOOK edits must ALSO go over the WebSocket as `scene_deck_sync` (client/lib/app-scene-deck.js): the
## server overlays its live deck mirror onto every autosave (routes-data-project-handlers.js:380
## enrichProjectScenesFromLiveDeck), so an autosave alone cannot change looks once a deck exists.
## deck_changed() = 100 ms debounce + 2 s echo memo, same as the web.

signal saved(rev: int)
signal save_failed(reason: String)

const DEBOUNCE_S := 3.0
const DECK_DEBOUNCE_S := 0.1
const DECK_ECHO_WINDOW_MS := 2000
const Policy := preload("res://core/project_sync_policy.gd")

var project_gone := false
var in_flight := false
var pending := false
var saves_ok := 0
var _skip_next_sync := false
var _timer: Timer
var _deck_timer: Timer
var _last_deck_json := ""
var _last_deck_at := 0
var deck_syncs_sent := 0
var _deck_pending := false


func _ready() -> void:
	_timer = Timer.new()
	_timer.one_shot = true
	_timer.wait_time = DEBOUNCE_S
	_timer.timeout.connect(flush)
	add_child(_timer)
	_deck_timer = Timer.new()
	_deck_timer.one_shot = true
	_deck_timer.wait_time = DECK_DEBOUNCE_S
	_deck_timer.timeout.connect(func() -> void: send_deck_sync(false))
	add_child(_deck_timer)
	# A deck edit made while the socket is down must not be lost (the web drops it; we resend on connect).
	Ws.connected.connect(func() -> void:
		if _deck_pending:
			send_deck_sync(true))


## Call after editing looks / presets (then mark_dirty() for the rest of the project).
func deck_changed() -> void:
	if not project_gone:
		_deck_timer.start()


func send_deck_sync(force: bool) -> bool:
	var data := build_deck_payload(Store.project)
	var json := JSON.stringify(data)
	var now := Time.get_ticks_msec()
	if not force and json == _last_deck_json and now - _last_deck_at < DECK_ECHO_WINDOW_MS:
		return false
	_last_deck_json = json
	_last_deck_at = now
	var ok := Ws.send({"type": "scene_deck_sync", "data": data})
	_deck_pending = not ok
	if ok:
		deck_syncs_sent += 1
	else:
		_last_deck_json = ""  # not sent → never treat a retry as an echo
	return ok


## client/lib/app-scene-deck.js buildSceneDeckPayload(), from the project document.
static func build_deck_payload(project: Dictionary) -> Dictionary:
	var root: Dictionary = project.get("scenes", {}) if project.get("scenes") is Dictionary else {}
	var scenes: Array = root.get("scenes", [])
	var looks := []
	for s in scenes:
		if s is Dictionary:
			var scope := str((s as Dictionary).get("mainScope", ""))
			looks.append({"id": str(s.get("id", "")), "name": str(s.get("name", "Untitled look")) if str(s.get("name", "")) != "" else "Untitled look", "mainScope": scope if scope != "" else "all"})
	var prv: Variant = root.get("previewSceneId")
	return {
		"looks": looks,
		"sceneSnapshots": scenes.duplicate(true),
		"previewSceneId": str(prv) if prv != null and str(prv) != "" else null,
		"layerPresets": (root.get("layerPresets", []) as Array).duplicate(true),
		"lookPresets": (root.get("lookPresets", []) as Array).duplicate(true),
	}


## Call after mutating Store.project (any edit). Debounced like the web autosave.
func mark_dirty(immediate := false) -> void:
	if project_gone:
		return
	if immediate:
		_timer.stop()
		flush()
	else:
		_timer.start()


## project_sync from the server: true = apply it, false = it is our own echo (skip once).
func accept_remote_sync() -> bool:
	if _skip_next_sync:
		_skip_next_sync = false
		return false
	return true


func flush() -> void:
	if project_gone or Store.project.is_empty():
		return
	if in_flight:
		pending = true
		return
	in_flight = true
	var retries := 0
	while true:
		Store.project["savedAt"] = Time.get_datetime_string_from_system(true) + "Z"
		var res: Dictionary = await Api.post_json("/api/project/autosave", {"project": Store.project})
		var verdict: Dictionary = Policy.decide(res, retries)
		match verdict.action:
			"ok":
				if verdict.rev > 0:
					Store.project["rev"] = verdict.rev
				if verdict.changed:
					_skip_next_sync = true
				saves_ok += 1
				saved.emit(verdict.rev)
			"retry":
				Store.project["rev"] = verdict.rev
				retries += 1
				continue
			"gone":
				project_gone = true
				save_failed.emit("project_gone")
			_:
				save_failed.emit(str(verdict.reason))
		break
	in_flight = false
	if pending:
		pending = false
		flush()
