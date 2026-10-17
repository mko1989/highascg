extends RefCounted
## Core services: config URL rules, WS backoff numbers, store paths, project normalize, API parsing.

const ConfigScript := preload("res://core/config.gd")
const StoreScript := preload("res://core/state_store.gd")
const NetUtil := preload("res://core/net_util.gd")
var t


func test_config_origin_precedence() -> void:
	t.eq(ConfigScript.resolve_origin({}, ""), "http://127.0.0.1:4200")
	t.eq(ConfigScript.resolve_origin({}, "http://box:4200/"), "http://box:4200")
	t.eq(ConfigScript.resolve_origin({"server": "http://x:1"}, "http://box:4200"), "http://x:1")


func test_ws_url_like_api_origin_js() -> void:
	t.eq(ConfigScript.ws_url_for("http://127.0.0.1:4200"), "ws://127.0.0.1:4200/api/ws")
	t.eq(ConfigScript.ws_url_for("https://box.tail:443"), "wss://box.tail:443/api/ws")


func test_parse_args() -> void:
	var a := ConfigScript.parse_args(PackedStringArray(["--server=http://a:1", "--fullscreen", "x"]))
	t.eq(a.get("server"), "http://a:1")
	t.eq(a.get("fullscreen"), "1")
	t.ok(not a.has("x"))


func test_reconnect_delay_matches_ws_client_js() -> void:
	# computeWsReconnectDelay: 1000·2^min(n-1,5) capped at 30000, jitter ≤ min(1000, 20 %).
	t.eq(NetUtil.reconnect_delay_ms(1, 1000, 30000, 1000, 0.0), 1000)
	t.eq(NetUtil.reconnect_delay_ms(2, 1000, 30000, 1000, 0.0), 2000)
	t.eq(NetUtil.reconnect_delay_ms(5, 1000, 30000, 1000, 0.0), 16000)
	t.eq(NetUtil.reconnect_delay_ms(6, 1000, 30000, 1000, 0.0), 30000)
	t.eq(NetUtil.reconnect_delay_ms(20, 1000, 30000, 1000, 0.0), 30000)
	t.eq(NetUtil.reconnect_delay_ms(1, 1000, 30000, 1000, 0.999), 1000 + 199)
	t.eq(NetUtil.reconnect_delay_ms(6, 1000, 30000, 1000, 0.999), 30000 + 999)


func test_store_paths() -> void:
	var root := {}
	StoreScript.write_path(root, "scene.live", {"1": {"sceneId": "x"}})
	t.eq(StoreScript.read_path(root, "scene.live.1.sceneId"), "x")
	t.eq(StoreScript.read_path(root, "scene.nope", "fb"), "fb")
	StoreScript.write_path(root, "a.b.c", 3)
	t.eq(StoreScript.read_path(root, "a.b.c"), 3)


func test_normalize_project_like_project_load_js() -> void:
	t.eq(StoreScript.normalize_project({"version": 2.0, "name": "x"}).get("name"), "x")
	t.eq(StoreScript.normalize_project({"project": {"version": 2.0, "name": "y"}}).get("name"), "y")
	t.eq(StoreScript.normalize_project({"error": "nope", "version": 1.0}), {})
	t.eq(StoreScript.normalize_project({"name": "no version"}), {})
	t.eq(StoreScript.normalize_project(null), {})


func test_api_parse_response() -> void:
	var ok := NetUtil.parse_response(HTTPRequest.RESULT_SUCCESS, 200, '{"a":1}'.to_utf8_buffer())
	t.ok(ok.ok)
	t.eq(ok.data.a, 1.0)
	var e := NetUtil.parse_response(HTTPRequest.RESULT_SUCCESS, 409, '{"reason":"stale_rev","error":"x"}'.to_utf8_buffer())
	t.ok(not e.ok)
	t.eq(e.status, 409)
	t.eq(e.reason, "stale_rev")
	var empty := NetUtil.parse_response(HTTPRequest.RESULT_SUCCESS, 204, PackedByteArray())
	t.ok(empty.ok)
	t.eq(empty.data, null)
	var transport := NetUtil.parse_response(HTTPRequest.RESULT_CANT_CONNECT, 0, PackedByteArray())
	t.ok(not transport.ok)


func test_settings_deep_merge() -> void:
	var target := {"osc": {"enabled": true, "listenPort": 6251.0}, "ui": {"x": 1}}
	NetUtil.deep_merge(target, {"osc": {"listenPort": 7000}, "new": 1})
	t.eq(target.osc.enabled, true)
	t.eq(target.osc.listenPort, 7000)
	t.eq(target.ui.x, 1)
	t.eq(target.new, 1)
