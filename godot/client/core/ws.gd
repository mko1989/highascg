extends Node
## WO-599 — WebSocket client for /api/ws. Same contract as client/lib/ws-client.js:
## envelope {type, data}; handlers get `data`; server {type:'error'} → "server_error"; reconnect with
## exponential backoff 1-2-4-8-16-30 s + ≤20 % jitter, forever; sends while not open are dropped.

signal connected
signal disconnected
signal message(type: String, data: Variant)

const NetUtil := preload("res://core/net_util.gd")
const AuthModel := preload("res://core/auth_model.gd")
const Demo := preload("res://core/demo/demo_server.gd")

const INBOUND_BUFFER := 64 * 1024 * 1024  # `state`/`project_sync` snapshots are multi-KB..MB; default is 64 KB
const OUTBOUND_BUFFER := 4 * 1024 * 1024

var is_open := false
var reconnect_attempts := 0
var messages_received := 0

var _peer: WebSocketPeer
var _handlers := {}  # type -> Array[Callable]
var _next_connect_ms := 0
var _started := false
var _watches := {}  # WO-797: watch type → {owner instance id: true}; said again on every connect
var _demo_inbox: Array = []  # WO-815: simulated-server broadcasts, delivered on the next frame like packets


## Called by the app after the HTTP bootstrap (same order as client/app.js).
func start() -> void:
	_started = true
	_next_connect_ms = 0
	if Config.demo:  # WO-815: no socket — the simulated server "connects" and sends its snapshot
		Demo.shared().broadcast.connect(func(t: String, d: Variant) -> void: _demo_inbox.append([t, d]))
		_demo_inbox.append(["state", Demo.shared().snapshot()])
		is_open = true
		connected.emit()
		_dispatch("connect", null)


func on(type: String, handler: Callable) -> void:
	if not _handlers.has(type):
		_handlers[type] = []
	(_handlers[type] as Array).append(handler)


## WO-797 — hold a server-side watch (`{type, data: {on}}`, e.g. tracking:fixtures_watch) while any owner holds it;
## the server is told on the first hold and the last release, and again after every reconnect.
func watch(type: String, owner: Object, on: bool) -> void:
	var holds: Dictionary = _watches.get(type, {})
	_watches[type] = holds
	if NetUtil.hold(holds, owner.get_instance_id(), on):
		send({"type": type, "data": {"on": not holds.is_empty()}})


func send(obj: Dictionary) -> bool:
	if Config.demo:
		return Demo.shared().on_ws(obj)
	if not is_open:
		return false
	return _peer.send_text(NetUtil.to_json(obj)) == OK


func _process(_delta: float) -> void:
	if not _started:
		return
	if Config.demo:
		for m in _demo_inbox.duplicate():
			_demo_inbox.pop_front()
			messages_received += 1
			var type: String = m[0]
			message.emit(type, m[1])
			_dispatch(type, m[1])
		return
	if _peer == null:
		if Time.get_ticks_msec() >= _next_connect_ms:
			_open()
		return
	_peer.poll()
	var st := _peer.get_ready_state()
	if st == WebSocketPeer.STATE_OPEN:
		if not is_open:
			is_open = true
			reconnect_attempts = 0
			for t in _watches:  # WO-797: the server forgot this client's watches with the old socket
				if not (_watches[t] as Dictionary).is_empty():
					send({"type": t, "data": {"on": true}})
			connected.emit()
			_dispatch("connect", null)
		while _peer.get_available_packet_count() > 0:
			_handle_packet(_peer.get_packet())
	elif st == WebSocketPeer.STATE_CLOSED:
		var was_open := is_open
		is_open = false
		_peer = null
		reconnect_attempts += 1
		_next_connect_ms = Time.get_ticks_msec() + NetUtil.reconnect_delay_ms(reconnect_attempts)
		if was_open:
			disconnected.emit()
			_dispatch("disconnect", null)


func _open() -> void:
	_peer = WebSocketPeer.new()
	_peer.inbound_buffer_size = INBOUND_BUFFER
	_peer.outbound_buffer_size = OUTBOUND_BUFFER
	_peer.max_queued_packets = 8192
	_peer.handshake_headers = AuthModel.headers()  # WO-811: the server checks the password on the upgrade
	var err := _peer.connect_to_url(Config.ws_url())
	if err != OK:
		_peer = null
		reconnect_attempts += 1
		_next_connect_ms = Time.get_ticks_msec() + NetUtil.reconnect_delay_ms(reconnect_attempts)


func _handle_packet(pkt: PackedByteArray) -> void:
	var text := pkt.get_string_from_utf8().strip_edges()
	if text == "" or (text[0] != "{" and text[0] != "["):
		return
	var msg: Variant = JSON.parse_string(text)
	if not (msg is Dictionary):
		return
	messages_received += 1
	var d: Dictionary = msg
	var type := str(d.get("type", ""))
	if type == "":
		return
	if type == "error":
		type = "server_error"
	var data: Variant = d.get("data")
	message.emit(type, data)
	_dispatch(type, data)


func _dispatch(type: String, data: Variant) -> void:
	for h in _handlers.get(type, []):
		(h as Callable).call(data)
