extends RefCounted
## WO-805 — the Caspar Apply POSTs restart Caspar before they answer (typ. 5-15 s, the server's own waits cap near
## ~100 s): they carry core/api.gd APPLY_TIMEOUT_S instead of the 15 s default, so a slow but successful Apply is no
## longer reported as a timeout while the server is still finishing it. Every other request keeps TIMEOUT_S.

const ApiScript := preload("res://core/api_timeouts.gd")
var t


func test_request_timeout_default_and_long() -> void:
	t.eq(ApiScript.request_timeout(0.0), ApiScript.TIMEOUT_S, "no timeout given: the 15 s default")
	t.eq(ApiScript.request_timeout(-1.0), ApiScript.TIMEOUT_S, "negative: the default")
	t.eq(ApiScript.request_timeout(ApiScript.APPLY_TIMEOUT_S), 120.0, "apply: 120 s")
	t.ok(ApiScript.APPLY_TIMEOUT_S > 110.0, "longer than the node relay's own 110 s (cluster-relay.js LONG_TIMEOUT_MS)")


func test_apply_calls_pass_the_long_timeout() -> void:
	var gesture := FileAccess.get_file_as_string("res://features/devices/cable_gesture.gd")
	t.ok(gesture.contains("post_json(\"/api/caspar-config/apply\", {\"force\": true}, ApiScript.APPLY_TIMEOUT_S)"),
		"Devices Apply (cable_gesture.gd) uses the long timeout")
	var flow := FileAccess.get_file_as_string("res://features/devices/server_flow.gd")
	t.ok(flow.contains("post_json(\"/api/replication/apply-device-view-caspar\", {}, ApiScript.APPLY_TIMEOUT_S)"),
		"hot-backup Caspar apply (server_flow.gd) uses the long timeout")
	var api := FileAccess.get_file_as_string("res://core/api.gd")
	t.ok(api.contains("const APPLY_TIMEOUT_S := Timeouts.APPLY_TIMEOUT_S"), "api.gd's constant is the shared one")
	t.ok(api.contains("r.timeout = request_timeout(timeout_s)"), "_send sets the per-request timeout")
	t.ok(api.contains("r.timeout = TIMEOUT_S"), "a pooled request is reset to the default on release")
