extends Node
## WO-599 — HTTP API client. A small pool of HTTPRequest nodes (Godot: one request per node) with an
## await-able interface. Mirrors client/lib/api-client.js: JSON in/out, errors carry status + reason.
## Result: { ok: bool, status: int, data: Variant, error: String, reason: String }.
## NOTE: Godot's JSON turns every number into float — compare ids as strings, cast counts with int().

signal _slot_freed
signal _opened

const NetUtil := preload("res://core/net_util.gd")

const POOL_SIZE := 6
const TIMEOUT_S := 15.0

var _free: Array[HTTPRequest] = []
## WO-732 P3a: a second client (core/devices_target.gd) talks to another server. `origin_override` "" = the connected
## server; while `held`, requests wait for `open()` (its origin is still being decided).
var origin_override := ""
var held := false


func _ready() -> void:
	for i in POOL_SIZE:
		var r := HTTPRequest.new()
		r.timeout = TIMEOUT_S
		r.use_threads = true
		add_child(r)
		_free.append(r)


func get_json(path: String) -> Dictionary:
	return await request(HTTPClient.METHOD_GET, path, null)


func post_json(path: String, body: Variant) -> Dictionary:
	return await request(HTTPClient.METHOD_POST, path, body)


func put_json(path: String, body: Variant) -> Dictionary:
	return await request(HTTPClient.METHOD_PUT, path, body)


func delete_json(path: String) -> Dictionary:
	return await request(HTTPClient.METHOD_DELETE, path, null)


func open() -> void:
	held = false
	_opened.emit()


func base() -> String:
	return origin_override if origin_override != "" else Config.origin


func request(method: int, path: String, body: Variant) -> Dictionary:
	while held:
		await _opened
	while _free.is_empty():
		await _slot_freed
	var r: HTTPRequest = _free.pop_back()
	var headers := PackedStringArray(["Accept: application/json"])
	var payload := ""
	if body != null:
		headers.append("Content-Type: application/json")
		payload = NetUtil.to_json(body)
	var err := r.request(base() + path, headers, method, payload)
	if err != OK:
		_release(r)
		return {"ok": false, "status": 0, "data": null, "error": "request failed (%s)" % error_string(err), "reason": ""}
	var res: Array = await r.request_completed
	_release(r)
	return NetUtil.parse_response(res[0], res[1], res[3])


## Binary GET (models, thumbnails, support bundle): { ok, status, bytes, headers, error }.
func get_bytes(path: String) -> Dictionary:
	while held:
		await _opened
	while _free.is_empty():
		await _slot_freed
	var r: HTTPRequest = _free.pop_back()
	var err := r.request(base() + path)
	if err != OK:
		_release(r)
		return {"ok": false, "status": 0, "bytes": PackedByteArray(), "headers": PackedStringArray(), "error": error_string(err)}
	var res: Array = await r.request_completed
	_release(r)
	var status: int = res[1]
	var ok: bool = res[0] == HTTPRequest.RESULT_SUCCESS and status >= 200 and status < 300
	var error := "" if ok else ("HTTP %d" % status if res[0] == HTTPRequest.RESULT_SUCCESS else NetUtil.transport_error(res[0]))
	return {"ok": ok, "status": status, "bytes": res[3], "headers": res[2], "error": error}


func _release(r: HTTPRequest) -> void:
	_free.append(r)
	_slot_freed.emit()
