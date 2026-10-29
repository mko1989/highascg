extends Node
## WO-599 — HTTP API client. A small pool of HTTPRequest nodes (Godot: one request per node) with an
## await-able interface. Mirrors client/lib/api-client.js: JSON in/out, errors carry status + reason.
## Result: { ok: bool, status: int, data: Variant, error: String, reason: String }.
## NOTE: Godot's JSON turns every number into float — compare ids as strings, cast counts with int().

signal _slot_freed

const NetUtil := preload("res://core/net_util.gd")
const AuthModel := preload("res://core/auth_model.gd")
const AuthPrompt := preload("res://core/auth_prompt.gd")
const Demo := preload("res://core/demo/demo_server.gd")

const POOL_SIZE := 6
const TIMEOUT_S := 15.0

var _free: Array[HTTPRequest] = []
## WO-802: every Api talks to Config.origin, this client's own server (WO-732's override to another server is
## gone). `relay_peer`: the id of a linked server this Api reaches THROUGH that server (GET|POST|DELETE
## /api/cluster/peers/:id/relay/…, server cluster-relay.js); "" = the server itself. Never a socket to another machine.
var relay_peer := ""


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


func base() -> String:
	return Config.origin + ("/api/cluster/peers/%s/relay" % relay_peer.uri_encode() if relay_peer != "" else "")


## WO-811: every request carries the shared password (AuthModel.headers); a 401 asks for it once and retries.
func request(method: int, path: String, body: Variant) -> Dictionary:
	if Config.demo:  # WO-815: the simulated server answers; nothing goes on the network
		if is_inside_tree():
			await get_tree().process_frame
		return Demo.shared().handle(method, path, body)
	var res := await _send(method, path, body)
	while AuthModel.needs_login(res) and await _login():
		res = await _send(method, path, body)
	return res


## WO-811: after a 401 — the node's own file on the box, else the prompt. → true when there is a new password to try.
func _login() -> bool:
	if Config.adopt_local_password():
		return true
	var pw: String = await AuthPrompt.ask(self, Config.password != "", Config.origin)
	if pw == "":
		return false
	Config.set_password(pw)
	return true


func _send(method: int, path: String, body: Variant) -> Dictionary:
	while _free.is_empty():
		await _slot_freed
	var r: HTTPRequest = _free.pop_back()
	var headers := AuthModel.with_auth(PackedStringArray(["Accept: application/json"]), AuthModel.password)
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
	if Config.demo:  # WO-815: no files behind the simulated server (models, thumbnails, bundles)
		if is_inside_tree():
			await get_tree().process_frame
		return {"ok": false, "status": 501, "bytes": PackedByteArray(), "headers": PackedStringArray(), "error": Demo.NOT_IN_DEMO}
	var res := await _send_bytes(path)
	while AuthModel.needs_login(res) and await _login():
		res = await _send_bytes(path)
	return res


func _send_bytes(path: String) -> Dictionary:
	while _free.is_empty():
		await _slot_freed
	var r: HTTPRequest = _free.pop_back()
	var err := r.request(base() + path, AuthModel.headers())
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
