extends Node
## WO-894 — the Visuals ▸ Shader mode's wire (the panel itself is visuals_shader_mode.gd): one shader's Shader Live ops
## (`POST /api/shader-live/shaders/:id/:op`, src/shaderfx/shader-live-session.js keeps the working GLSL) and the recompile of the
## Visuals' own runner (shadertoy_rd.gd) from what the ops did.
## Ops go one at a time, in order; a value op (set / macro) still waiting for its turn is replaced by a newer one on the same key
## (a drag only ever has its latest value in flight). After ops landed the working copy is fetched (`GET …/shaders/:id?working=1`:
## the view + the rewritten GLSL), merged over the library config (channels, opts) and handed to `compiled`. Compiling is a glslang
## run on this thread: at most one per `compile_ms` while ops keep coming, and the last value always lands.

signal view_changed(view: Dictionary, rebuild: bool)  # an op's reply or a fresh load; rebuild = the controls change shape
signal compiled(id: String, cfg: Dictionary)
signal failed(text: String)

const VALUE_OPS := ["set", "macro"]

var api_cb: Callable  # → the box api (get_json / post_json) or null
var clock: Callable = func() -> int: return Time.get_ticks_msec()
var compile_ms := 350
var id := ""
var compiles := 0
var _queue: Array = []  # {op, body, rebuild, id}
var _busy := false
var _stale := false  # an op landed since the last compile
var _last := -1000000
var _gen := 0  # bumped by load_shader: work for the shader before it is dropped
var _lib := {}  # id → library config (GET /api/shaders/:id), the base the working GLSL is merged over


func _api() -> Variant:
	return api_cb.call() if api_cb.is_valid() else null


## Switch to shader `sid` ("" = none): its view (+ working GLSL) arrives as view_changed; a shader with live edits (dirty) is
## compiled from them at once, so the preview shows what the controls show.
func load_shader(sid: String) -> void:
	_gen += 1
	_queue.clear()
	_stale = false
	id = sid
	if sid == "" or _api() == null:
		return
	var gen := _gen
	var r: Dictionary = await _api().get_json(_view_path(sid))
	if gen != _gen:
		return
	if not r.get("ok") or not r.get("data") is Dictionary:
		failed.emit("Load failed: %s" % str(r.get("error", r.get("status", ""))))
		return
	view_changed.emit(r.data, true)
	if r.data.get("dirty") == true and r.data.get("working") is Dictionary:
		await _compile(r.data.working, gen)


## One op for the loaded shader. `rebuild`: the controls are drawn again from the reply (presets, pin, hide …).
func post_op(op: String, body: Dictionary, rebuild := true) -> void:
	if id == "":
		failed.emit("This layer has no shader picked.")
		return
	var entry := {"op": op, "body": body, "rebuild": rebuild, "id": id}
	if op in VALUE_OPS:
		var k := _key_of(entry)
		for i in _queue.size():
			if _key_of(_queue[i]) == k:
				_queue[i] = entry
				return
	_queue.append(entry)
	_pump()


static func _key_of(e: Dictionary) -> String:
	return "%s:%s" % [e.op, str(e.body.get("key", e.body.get("control", "")))]


static func _view_path(sid: String) -> String:
	return "/api/shader-live/shaders/%s?working=1" % sid.uri_encode()


func _pump() -> void:
	if _busy:
		return
	_busy = true
	var gen := _gen
	while gen == _gen:
		var due: bool = clock.call() - _last >= compile_ms
		if _stale and due:
			await _compile(null, gen)
		elif not _queue.is_empty():
			await _send(_queue.pop_front(), gen)
		elif _stale:
			if is_inside_tree():
				await get_tree().create_timer(maxf(0.001, (compile_ms - (clock.call() - _last)) / 1000.0)).timeout
			else:
				_last = -1000000
		else:
			break
	if gen == _gen:
		_busy = false
	else:
		_busy = false
		if not _queue.is_empty() or _stale:
			_pump.call_deferred()


func _send(e: Dictionary, gen: int) -> void:
	var api: Variant = _api()
	if api == null:
		failed.emit("No box connection: the shader controls live on the box.")
		return
	var r: Dictionary = await api.post_json("/api/shader-live/shaders/%s/%s" % [str(e.id).uri_encode(), e.op], e.body)
	if gen != _gen:
		return
	var d: Variant = r.get("data")
	if not r.get("ok") or not d is Dictionary or not d.get("ok", false):
		failed.emit("%s failed: %s" % [e.op, str(d.get("error", r.get("error", ""))) if d is Dictionary else str(r.get("error", ""))])
		return
	_stale = true
	if d.get("view") is Dictionary:
		(d.view as Dictionary)["saved_as"] = str(d.get("savedAs", ""))
		view_changed.emit(d.view, e.rebuild)
	var push: Variant = d.get("push")
	if push is Dictionary and not (push.get("errors", []) as Array).is_empty():
		failed.emit("CG UPDATE failed: %s" % str(push.errors[0]))  # on-air instances of this shader; the Visuals preview is fine


## Fetch the working GLSL (unless `working` is given), merge it over the library config, hand it to `compiled`.
func _compile(working: Variant, gen: int) -> void:
	_stale = false
	_last = clock.call()
	var api: Variant = _api()
	var sid := id
	if api == null:
		return
	if not working is Dictionary:
		var r: Dictionary = await api.get_json(_view_path(sid))
		if gen != _gen:
			return
		if not r.get("ok") or not r.get("data") is Dictionary or not r.data.get("working") is Dictionary:
			failed.emit("The box does not send the working GLSL — restart the highascg service (WO-894).")
			return
		working = r.data.working
	if not _lib.has(sid):
		var l: Dictionary = await api.get_json("/api/shaders/" + sid.uri_encode())
		if gen != _gen:
			return
		if not l.get("ok") or not l.get("data") is Dictionary:
			failed.emit("Library shader %s not found." % sid)
			return
		_lib[sid] = l.data
	compiles += 1
	compiled.emit(sid, merged(_lib[sid], working))


## The library config with the working copy's GLSL over it (channels, opts and the rest stay the library's).
static func merged(lib: Dictionary, working: Dictionary) -> Dictionary:
	var cfg := lib.duplicate(true)
	cfg["common"] = str(working.get("common", ""))
	var ps: Dictionary = cfg.get("passes") if cfg.get("passes") is Dictionary else {}
	var wp: Dictionary = working.get("passes") if working.get("passes") is Dictionary else {}
	for k in wp:
		var src: String = str((wp[k] as Dictionary).get("source", "")) if wp[k] is Dictionary else ""
		if ps.get(k) is Dictionary:
			(ps[k] as Dictionary)["source"] = src
		else:
			ps[k] = {"source": src}
	cfg["passes"] = ps
	return cfg
