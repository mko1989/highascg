extends RefCounted
## WO-1088 — the client's frame cap follows what it feeds. WO-907: while the client publishes a surface Caspar plays
## (features/shm_out/viewport_publisher.gd: Visuals on air, a Live source, a solo bus) its loop runs free (vsync off) at
## TWICE that channel's rate, so the newest frame Caspar takes each tick is at most half a tick old and one slow frame
## never costs a whole tick. Without a publisher, twice the monitor rate buys nothing: the cap is the monitor's refresh
## (the show's channel rate when the refresh is unknown). Vsync stays off either way (the alt-tab stall finding stands).
## Seamless: a publisher raises the cap in start(), before its first frame; the cap comes down only HOLD_S after the
## last publisher stopped (a re-start in between — a resize, Send off/on — never dips). `--max-fps N` on the command
## line is the operator's own cap: never touched. project.godot keeps max_fps=100, the boot value until boot() runs.

const HOLD_S := 5.0
const SETTLE_MS := 6000  # after a publisher starts (its shaders compile, the cap rises) fps is judged only after this
const FALLBACK_FPS := 60

static var channel_fps := 0.0  ## the show's program rate (channelMap) — used when the monitor's refresh is unknown
static var _active := {}  # publisher instance id → the channel fps it feeds
static var _lower_seq := 0
static var _started_ms := -100000  # when the last publisher started
static var _operator_cap := -1  # -1: not read yet; 0: none; else the --max-fps the client was started with


## The monitor's refresh, rounded; else the show's channel rate; else 60.
static func idle_fps(monitor_hz: float, ch_fps: float) -> int:
	if monitor_hz >= 20.0:
		return roundi(monitor_hz)
	return roundi(ch_fps) if ch_fps > 0.0 else FALLBACK_FPS


## Twice the fastest channel a publisher feeds (25 → 50, 50 → 100, 60 → 120), never below the idle cap.
static func target_fps(monitor_hz: float, ch_fps: float, rates: Array) -> int:
	var idle := idle_fps(monitor_hz, ch_fps)
	var top := 0.0
	for r in rates:
		top = maxf(top, float(r))
	return idle if top <= 0.0 else maxi(idle, roundi(2.0 * top))


## `--max-fps N` / `--max-fps=N` among the engine args → N, else 0.
static func cap_from_args(args: PackedStringArray) -> int:
	for i in args.size():
		var a := args[i]
		if a.begins_with("--max-fps="):
			return int(a.get_slice("=", 1))
		if a == "--max-fps" and i + 1 < args.size():
			return int(args[i + 1])
	return 0


static func operator_cap() -> int:
	if _operator_cap < 0:
		_operator_cap = cap_from_args(OS.get_cmdline_args())
	return _operator_cap


static func publishing() -> bool:
	return not _active.is_empty()


## The fastest channel being fed (0 when nothing publishes).
static func fed_fps() -> float:
	var top := 0.0
	for r in _active.values():
		top = maxf(top, float(r))
	return top


static func monitor_hz() -> float:
	return DisplayServer.screen_get_refresh_rate()  # -1 when unknown (headless)


## The cap this client is meant to hold right now (what its fps is judged against).
static func target() -> int:
	if operator_cap() > 0:
		return operator_cap()
	return Engine.max_fps if Engine.max_fps > 0 else idle_fps(monitor_hz(), channel_fps)


## Why the target is what it is, in words for the health panel.
static func why() -> String:
	if operator_cap() > 0:
		return "--max-fps %d" % operator_cap()
	if publishing():
		return "2× the %d fps show, feeding Caspar" % roundi(fed_fps())
	var hz := monitor_hz()
	return ("the %d Hz monitor" % roundi(hz)) if hz >= 20.0 else ("the %d fps show" % idle_fps(hz, channel_fps))


## True for SETTLE_MS after a publisher started: a Visuals source going on air compiles its shaders and the per-second
## fps average trails the raised cap — not a "not keeping up" incident.
static func settling() -> bool:
	return Time.get_ticks_msec() - _started_ms < SETTLE_MS


## Shell, once at start: the boot cap (project max_fps 100) comes down after HOLD_S unless a publisher started.
static func boot() -> void:
	_schedule_apply()


static func publish_started(id: int, fps: float) -> void:
	_active[id] = fps
	_started_ms = Time.get_ticks_msec()
	_lower_seq += 1  # a pending lowering is void
	_apply()


static func publish_stopped(id: int) -> void:
	if _active.erase(id):
		_schedule_apply()


static func _schedule_apply() -> void:
	_lower_seq += 1
	var seq := _lower_seq
	var tree := Engine.get_main_loop() as SceneTree
	if tree == null:
		return
	tree.create_timer(HOLD_S).timeout.connect(func() -> void:
		if seq == _lower_seq:
			_apply())


static func _apply() -> void:
	if operator_cap() > 0:
		return
	var t := target_fps(monitor_hz(), channel_fps, _active.values())
	if Engine.max_fps != t:
		Engine.max_fps = t
