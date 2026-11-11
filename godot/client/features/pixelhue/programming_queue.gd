extends Node
## WO-1039 — the Programming panel's geometry sender: drives programming_sync.gd (the pure queue) against
## POST /api/pixelhue/studio/programming/geometry {changes: [...]} — one request in flight, paced at 40 ms, newest
## pending window per layer. `api_fn` gives the HTTP client, `can_send` says whether the panel allows a send now
## (state loaded, no other command running). The panel adopts accepted windows from `result`.

signal result(data: Dictionary, accepted: Array)
signal failed(error: String)
signal changed()
signal done()

const StudioApi := preload("res://features/pixelhue/studio_api.gd")
const Sync := preload("res://features/pixelhue/programming_sync.gd")

var sync := Sync.new()
var api_fn: Callable
var can_send: Callable = func() -> bool: return true
var _waiting := false


func put(change: Dictionary, immediate: bool) -> void:
	sync.put(change, immediate)
	changed.emit()
	pump()


## Send the newest positions now (release / Enter), as soon as the running request is answered.
func flush() -> void:
	sync.force()
	pump()


func retry() -> void:
	sync.retry()
	changed.emit()
	pump()


func reset() -> void:
	sync.reset()
	changed.emit()


func pump() -> void:
	if not is_inside_tree():
		return
	var now := Time.get_ticks_msec()
	var ok: bool = can_send.call()
	var wait := sync.wait_ms(now, ok)
	if wait < 0:
		return
	if wait > 0:
		if not _waiting:
			_waiting = true
			get_tree().create_timer(wait / 1000.0).timeout.connect(func() -> void:
				_waiting = false
				pump())
		return
	var batch := sync.take(now, ok)
	if batch.is_empty():
		return
	var ep := sync.epoch
	changed.emit()
	var r: Dictionary = await StudioApi.write(api_fn.call(), "programming/geometry", {"changes": batch})
	var accepted := sync.complete(ep, r.ok == true, str(r.get("error", "")))
	if ep == sync.epoch:
		if r.ok == true:
			result.emit(r.data, accepted)
		else:
			failed.emit(str(r.get("error", "")))
	changed.emit()
	done.emit()
	pump()


## Wait until every pending position is confirmed (Studio drain). false = a write failed (Retry) or the panel cannot
## send now; the caller does not run its command then.
func drain() -> bool:
	while (sync.dirty or sync.saving) and sync.failure == "":
		if not can_send.call() or not is_inside_tree():
			return false
		if not sync.saving:
			flush()
		if sync.saving:
			await done
		elif sync.dirty:
			return false
	return sync.failure == ""
