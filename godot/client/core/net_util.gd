extends RefCounted
## WO-599 — pure networking helpers (no autoload references, so tests and tools can load them alone).


## client/lib/ws-client.js computeWsReconnectDelay (WO-104), same numbers.
static func reconnect_delay_ms(attempt: int, base_ms := 1000, max_ms := 30000, jitter_max := 1000, jitter_rand := -1.0) -> int:
	var n: int = max(1, attempt)
	var exp_ms: int = min(max_ms, base_ms * int(pow(2, min(n - 1, 5))))
	var r := randf() if jitter_rand < 0.0 else jitter_rand
	var jitter := int(floor(r * min(float(jitter_max), exp_ms * 0.2)))
	return exp_ms + jitter


## WO-737 — a failed HTTPRequest in words; the bare "transport error 2" told the operator nothing.
static func transport_error(result: int) -> String:
	match result:
		HTTPRequest.RESULT_CANT_CONNECT, HTTPRequest.RESULT_CONNECTION_ERROR, HTTPRequest.RESULT_NO_RESPONSE:
			return "server not reachable (restarting or offline)"
		HTTPRequest.RESULT_CANT_RESOLVE:
			return "server address not found"
		HTTPRequest.RESULT_TIMEOUT:
			return "server did not answer in time"
	return "network error (HTTP request result %d)" % result


## HTTPRequest result → { ok, status, data, error, reason } (client/lib/api-client.js error shape).
static func parse_response(result: int, status: int, body: PackedByteArray) -> Dictionary:
	if result != HTTPRequest.RESULT_SUCCESS:
		return {"ok": false, "status": status, "data": null, "error": transport_error(result), "reason": ""}
	var data: Variant = null
	var text := body.get_string_from_utf8()
	if text.strip_edges() != "":
		data = JSON.parse_string(text)
		if data == null and text.strip_edges() != "null":
			data = text  # non-JSON body (rare: plain-text errors)
	var ok := status >= 200 and status < 300
	var reason := ""
	var error := ""
	if not ok:
		if data is Dictionary:
			reason = str((data as Dictionary).get("reason", ""))
			error = str((data as Dictionary).get("error", (data as Dictionary).get("message", "")))
		if error == "":
			error = "HTTP %d" % status
	return {"ok": ok, "status": status, "data": data, "error": error, "reason": reason}


## Nested dictionaries merge; other values replace (settings patches).
static func deep_merge(target: Dictionary, src: Dictionary) -> void:
	for k in src:
		if src[k] is Dictionary and target.get(k) is Dictionary:
			deep_merge(target[k], src[k])
		else:
			target[k] = src[k]


## WO-598 B — JSON for the wire: source key order kept (the server's projectContentEquals compares
## JSON.stringify output, so sorted keys made every Godot save look "changed") and full float precision
## (the default 15 significant digits rewrote web-made values such as 1/3). Godot writes 25 as 25.0,
## which JSON.parse reads as the same number.
static func to_json(v: Variant) -> String:
	return JSON.stringify(v, "", false, true)


## WO-797 — `holds` (owner instance id → true) after `id` holds (`on`) or releases a watch; true when "anyone holds it"
## flipped, i.e. the server must be told.
static func hold(holds: Dictionary, id: int, on: bool) -> bool:
	var was := not holds.is_empty()
	if on:
		holds[id] = true
	else:
		holds.erase(id)
	return was != (not holds.is_empty())
