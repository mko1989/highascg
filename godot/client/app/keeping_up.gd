extends Node
## WO-1088 — the "keeping up" watch of this client. Once a second (a Timer, no per-frame work) it judges its own fps
## against the cap app/render_pacer.gd holds, debounced (app/keeping_up_model.gd); the server's checks arrive on WS
## `health:keeping-up` (on change) and GET /api/health/keeping-up (on connect, and every 2 s while the health panel is
## open). The merged summary drives the header pulse icon + label (app/shell.gd) and the panel (app/perf_overlay.gd).
## A not-ok own check is reported to the server (POST …/report, on change and every 10 s while it lasts), so it gets a
## journal line and the other clients see it.

const M := preload("res://app/keeping_up_model.gd")
const Pacer := preload("res://app/render_pacer.gd")
const REPORT_EVERY_S := 10.0
const BOOT_GRACE_MS := 15000  # a launching client loads the show and its tabs: slow first seconds are not an incident

signal changed(summary: Dictionary)

var summary: Dictionary = {"level": 0, "status": "ok", "label": "", "checks": [], "incidents": []}
var server: Variant = {}
var client_id := "%d-%d" % [OS.get_process_id(), randi() % 100000]
var _state := {"status": M.OK}
var _local: Dictionary = {}
var _since_report := 0.0
var _reported_level := 0
var _busy := false


func _ready() -> void:
	var t := Timer.new()
	t.wait_time = 1.0
	t.autostart = true
	t.timeout.connect(_sample)
	add_child(t)
	Pacer.boot()
	Ws.on("health:keeping-up", func(d: Variant) -> void:
		server = d
		_merge())
	Ws.connected.connect(refresh)
	Ws.disconnected.connect(func() -> void:
		server = {}
		_merge())


## This client's own debounced fps level (the health panel's FPS row colour).
func own_level() -> int:
	return int(_state.status)


## GET the server's summary now (on connect; the health panel calls it while open).
func refresh() -> void:
	if _busy:
		return
	_busy = true
	var r: Dictionary = await Api.get_json("/api/health/keeping-up")
	_busy = false
	if r.ok and r.data is Dictionary:
		server = r.data
		_merge()


func _channel_fps() -> float:
	var cm: Variant = Store.get_value("channelMap", {})
	var res: Variant = (cm as Dictionary).get("programResolutions") if cm is Dictionary else null
	if res is Array and not (res as Array).is_empty() and res[0] is Dictionary:
		return float(res[0].get("fps", 0))
	return 0.0


func _sample() -> void:
	Pacer.channel_fps = _channel_fps()
	var target := Pacer.target()
	var pub := Pacer.publishing()
	var fps := Engine.get_frames_per_second()
	var raw := M.OK if Time.get_ticks_msec() < BOOT_GRACE_MS or Pacer.settling() else M.fps_level(fps, target, pub, Pacer.fed_fps())
	_state = M.step(_state, raw)
	var lvl := int(_state.status)
	_local = M.fps_check(fps, target, Pacer.why(), lvl, pub)
	_since_report += 1.0
	if lvl != _reported_level or (lvl > M.OK and _since_report >= REPORT_EVERY_S):
		_report(fps, target, lvl, pub)
	_merge()


func _report(fps: float, target: int, lvl: int, pub: bool) -> void:
	_reported_level = lvl
	_since_report = 0.0
	if not Ws.is_open:
		return
	var who := "Operator client" if DevicesTarget.on_box() else "Client %s" % OS.get_environment("HOSTNAME")
	var c := M.fps_check(fps, target, Pacer.why(), lvl, pub, who)
	c["client"] = client_id
	c["key"] = "fps"
	Api.post_json("/api/health/keeping-up/report", c)


func _merge() -> void:
	var before := [summary.level, summary.label]
	summary = M.merge(server, [_local] if not _local.is_empty() else [], client_id)
	if [summary.level, summary.label] != before:  # the header only cares about these; the panel reads `summary`
		changed.emit(summary)
