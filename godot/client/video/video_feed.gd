extends RefCounted
## WO-670 P1 — live pictures when the server runs on ANOTHER machine (no /dev/shm here). One WebSocket to
## /api/video-feed: the server JPEG-encodes the surfaces this client holds (src/system/video-feed.js).
## Wire: text {"roles":[…]} up (sent whenever the held set changes); binary [u8 n][role][JPEG] down.
## Only the newest JPEG per role is decoded, so a slow frame never queues latency. Reconnects like core/ws.gd.

const NetUtil := preload("res://core/net_util.gd")
const ConfigScript := preload("res://core/config.gd")
const Platform := preload("res://core/platform.gd")
const LOST_AFTER_MS := 2000
const INBOUND_BUFFER := 16 * 1024 * 1024


## Same face as shm_reader.gd (poll / signal_lost / width / height / frame), so panels don't care where pictures
## come from. `frame` is RGBA8 (ShmTexture.update_rgba), not shm's BGRA.
class RoleReader:
	extends RefCounted
	var frame := PackedByteArray()
	var width := 0
	var height := 0
	var signal_lost := true
	var pending := PackedByteArray()  # newest JPEG not yet decoded
	var last_ms := -1

	func poll() -> bool:
		signal_lost = last_ms < 0 or Time.get_ticks_msec() - last_ms > LOST_AFTER_MS
		if pending.is_empty():
			return false
		var jpg := pending
		pending = PackedByteArray()
		var img := Image.new()
		if img.load_jpg_from_buffer(jpg) != OK:
			return false
		img.convert(Image.FORMAT_RGBA8)
		width = img.get_width()
		height = img.get_height()
		frame = img.get_data()
		return true


var url := ""
var readers := {}  # role -> RoleReader
var frames_in := 0
var _peer: WebSocketPeer
var _sent := ""
var _attempts := 0
var _next_connect_ms := 0


func _init(feed_url: String) -> void:
	url = feed_url


func reader(role: String) -> RoleReader:
	if not readers.has(role):
		readers[role] = RoleReader.new()
	return readers[role]


func is_open() -> bool:
	return _peer != null and _peer.get_ready_state() == WebSocketPeer.STATE_OPEN


## Once per frame with the roles currently held: connects when something is wanted, tells the server the held set,
## files incoming JPEGs on their readers.
func pump(roles: Array) -> void:
	if _peer == null:
		if roles.is_empty() or Time.get_ticks_msec() < _next_connect_ms:
			return
		_peer = WebSocketPeer.new()
		_peer.inbound_buffer_size = INBOUND_BUFFER
		_sent = ""
		if _peer.connect_to_url(url) != OK:
			_retry_later()
			return
	_peer.poll()
	var st := _peer.get_ready_state()
	if st == WebSocketPeer.STATE_CLOSED:
		_retry_later()
		return
	if st != WebSocketPeer.STATE_OPEN:
		return
	_attempts = 0
	var want := JSON.stringify({"roles": roles})
	if want != _sent and _peer.send_text(want) == OK:
		_sent = want
	while _peer.get_available_packet_count() > 0:
		var f := parse_frame(_peer.get_packet())
		if f.is_empty():
			continue
		frames_in += 1
		var r := reader(f[0])
		r.pending = f[1]
		r.last_ms = Time.get_ticks_msec()


func _retry_later() -> void:
	_peer = null
	_attempts += 1
	_next_connect_ms = Time.get_ticks_msec() + NetUtil.reconnect_delay_ms(_attempts)


## [u8 n][role][JPEG] → [role, jpeg], or [] when malformed.
static func parse_frame(pkt: PackedByteArray) -> Array:
	if pkt.size() < 4:
		return []
	var n: int = pkt[0]
	if n == 0 or pkt.size() < 1 + n + 2:
		return []
	return [pkt.slice(1, 1 + n).get_string_from_ascii(), pkt.slice(1 + n)]


## Feed when the server is not on this machine. `--video=feed` / `--video=shm` force it (feed on the box = testing).
static func wanted(origin: String, args: Dictionary) -> bool:
	if args.has("video"):
		return str(args["video"]) == "feed"
	return not Platform.is_local_origin(origin)


## ws(s)://host:port/api/video-feed?width=…&fps=… (`--video-width=`, `--video-fps=`; the server clamps).
static func url_for(origin: String, args: Dictionary) -> String:
	var base := ConfigScript.ws_url_for(origin).trim_suffix("/api/ws")
	return "%s/api/video-feed?width=%d&fps=%d" % [base, int(args.get("video-width", 960)), int(args.get("video-fps", 15))]
