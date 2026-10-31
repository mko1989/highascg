extends RefCounted
## WO-900 — MIDI out for the APC40's lights. Godot has no MIDI output API, so the bytes go out through ALSA's own tool,
## `amidi -p <port> -S "<hex>"` (alsa-utils, on the box), run off the main thread one at a time; amidi opens only the
## device's output side, so it never takes the input this client reads. `amidi -l` finds the port. pump() runs the queue
## (call it from a timer); a missing amidi leaves `error` set and sends nothing.

var port := ""
var error := ""
var sent := 0  ## amidi runs done (the tests and probes read it)
var _task := -1
var _queue := PackedStringArray()
var _list := []  # amidi -l output, filled by the worker
var _listing := false
var _task_lists := false  # the running task is the `amidi -l`
var _on_list: Callable


## Queue bytes (hex) for the port; they go out in order, joined into one amidi run per pump.
func send(hex: String) -> void:
	if hex.strip_edges() != "":
		_queue.append(hex)


## Ask `amidi -l` for the ports; `done.call(listing)` runs on the main thread from a later pump().
func list_ports(done: Callable) -> void:
	_on_list = done
	_listing = true


func pump() -> void:
	if _task >= 0:
		if not WorkerThreadPool.is_task_completed(_task):
			return
		WorkerThreadPool.wait_for_task_completion(_task)
		_task = -1
		if _task_lists:
			_task_lists = false
			_listing = false
			if _list.is_empty() or int(_list[0]) < 0:
				error = "amidi not found — install alsa-utils for the pad lights"
			elif _on_list.is_valid():
				_on_list.call(str(_list[1]) if _list.size() > 1 else "")
			return
	if _listing:
		_list.clear()
		_task_lists = true
		var out := _list
		_task = WorkerThreadPool.add_task(func() -> void:
			var o := []
			out.append(OS.execute("amidi", ["-l"], o))
			out.append("" if o.is_empty() else str(o[0])))
		return
	if _queue.is_empty() or port == "":
		return
	var hex := " ".join(_queue)
	_queue.clear()
	var p := port
	sent += 1
	_task = WorkerThreadPool.add_task(func() -> void: OS.execute("amidi", ["-p", p, "-S", hex]))


func busy() -> bool:
	return _task >= 0 or _listing
