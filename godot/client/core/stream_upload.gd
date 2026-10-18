extends RefCounted
## Streaming multipart upload (one file) over a raw StreamPeerTCP. Godot's HTTPRequest needs the whole body in memory,
## and media files are GBs, so the file is sent in 1 MiB chunks with a precomputed Content-Length (the server parses
## multipart as a stream — busboy). Plain http:// only (the server's origin). Used by the media-file inspector's
## "New version…" (POST /api/media/version/upload); reusable for media uploads (WO-603).

const NetUtil := preload("res://core/net_util.gd")
const CHUNK := 1 << 20
const CONNECT_TIMEOUT_MS := 5000
const RESPONSE_TIMEOUT_MS := 120000


## "http://host:port" → {host, port}; {} when not plain http.
static func parse_origin(origin: String) -> Dictionary:
	var o := origin.strip_edges().trim_suffix("/")
	if not o.begins_with("http://"):
		return {}
	var hp := o.substr(7)
	if hp.contains("/"):
		hp = hp.substr(0, hp.find("/"))
	var i := hp.rfind(":")
	if i < 0:
		return {"host": hp, "port": 80}
	return {"host": hp.substr(0, i), "port": hp.substr(i + 1).to_int()}


## Multipart framing around the file bytes (field "file").
static func multipart_parts(boundary: String, file_name: String) -> Dictionary:
	var safe := file_name.replace("\"", "_").replace("\r", "").replace("\n", "")
	var head := "--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\nContent-Type: application/octet-stream\r\n\r\n" % [boundary, safe]
	return {"head": head.to_utf8_buffer(), "tail": ("\r\n--%s--\r\n" % boundary).to_utf8_buffer()}


static func request_head(host: String, port: int, path: String, boundary: String, content_length: int) -> PackedByteArray:
	return ("POST %s HTTP/1.1\r\nHost: %s:%d\r\nAccept: application/json\r\nContent-Type: multipart/form-data; boundary=%s\r\nContent-Length: %d\r\nConnection: close\r\n\r\n" % [
		path, host, port, boundary, content_length]).to_utf8_buffer()


## Raw HTTP/1.1 response → {status, body} (chunked transfer decoded). status 0 = unparseable.
static func parse_http_response(raw: PackedByteArray) -> Dictionary:
	var text_head_end := -1
	for i in range(0, raw.size() - 3):
		if raw[i] == 13 and raw[i + 1] == 10 and raw[i + 2] == 13 and raw[i + 3] == 10:
			text_head_end = i
			break
	if text_head_end < 0:
		return {"status": 0, "body": PackedByteArray()}
	var head := raw.slice(0, text_head_end).get_string_from_utf8().split("\r\n")
	var parts := head[0].split(" ")
	var status := parts[1].to_int() if parts.size() > 1 else 0
	var chunked := false
	for h in head:
		if h.to_lower().begins_with("transfer-encoding:") and h.to_lower().contains("chunked"):
			chunked = true
	var body := raw.slice(text_head_end + 4)
	if chunked:
		var out := PackedByteArray()
		var pos := 0
		while pos < body.size():
			var eol := pos
			while eol + 1 < body.size() and not (body[eol] == 13 and body[eol + 1] == 10):
				eol += 1
			var n := body.slice(pos, eol).get_string_from_ascii().split(";")[0].strip_edges().hex_to_int()
			if n <= 0:
				break
			out.append_array(body.slice(eol + 2, eol + 2 + n))
			pos = eol + 2 + n + 2
		body = out
	return {"status": status, "body": body}


## Upload `file_path` to `path` (with query). progress(sent: int, total: int). Returns the Api-shaped result.
static func upload(origin: String, path: String, file_path: String, progress := Callable()) -> Dictionary:
	var fail := func(msg: String) -> Dictionary: return {"ok": false, "status": 0, "data": null, "error": msg, "reason": ""}
	var hp := parse_origin(origin)
	if hp.is_empty():
		return fail.call("upload needs a plain http:// server origin")
	var f := FileAccess.open(file_path, FileAccess.READ)
	if f == null:
		return fail.call("cannot read %s" % file_path.get_file())
	var tree := Engine.get_main_loop() as SceneTree
	var boundary := "----highascg%08x%08x" % [randi(), randi()]
	var mp := multipart_parts(boundary, file_path.get_file())
	var total: int = mp.head.size() + f.get_length() + mp.tail.size()
	var tcp := StreamPeerTCP.new()
	if tcp.connect_to_host(str(hp.host), int(hp.port)) != OK:
		return fail.call("connect failed")
	var t0 := Time.get_ticks_msec()
	while tcp.get_status() == StreamPeerTCP.STATUS_CONNECTING and Time.get_ticks_msec() - t0 < CONNECT_TIMEOUT_MS:
		await tree.process_frame
		tcp.poll()
	if tcp.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		return fail.call("connect timeout")
	tcp.put_data(request_head(str(hp.host), int(hp.port), path, boundary, total))
	tcp.put_data(mp.head)
	var sent: int = mp.head.size()
	while f.get_position() < f.get_length():
		var chunk := f.get_buffer(CHUNK)
		if tcp.put_data(chunk) != OK:
			return fail.call("connection lost while uploading")
		sent += chunk.size()
		if progress.is_valid():
			progress.call(sent, total)
		await tree.process_frame
	tcp.put_data(mp.tail)
	var raw := PackedByteArray()
	t0 = Time.get_ticks_msec()
	while Time.get_ticks_msec() - t0 < RESPONSE_TIMEOUT_MS:
		tcp.poll()
		var n := tcp.get_available_bytes()
		if n > 0:
			raw.append_array(tcp.get_data(n)[1])
		elif tcp.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			break
		else:
			await tree.process_frame
	tcp.disconnect_from_host()
	var r := parse_http_response(raw)
	if int(r.status) == 0:
		return fail.call("no response")
	return NetUtil.parse_response(HTTPRequest.RESULT_SUCCESS, int(r.status), r.body)
