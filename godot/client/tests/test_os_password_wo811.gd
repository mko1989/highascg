extends RefCounted
## WO-811 phase 3 — Settings → Nuclear "Change casparcg login password…": the request builder, box-only availability,
## the status text, and the pane posting it through the nuclear gate.

const M := preload("res://features/settings/os_password_model.gd")
var t


func test_request_builder() -> void:
	t.eq(M.PATH, "/api/system/gui-launch", "the gui-launch route (behind the nuclear gate)")
	t.eq(M.request_body(), {"action": "os-password"}, "a fixed action, no password, nothing else")
	var a: Dictionary = M.request_body()
	a["x"] = 1
	t.eq(M.request_body(), {"action": "os-password"}, "a fresh body each time")


func test_only_on_the_box() -> void:
	t.eq(M.available("http://127.0.0.1:4200"), true, "on the box (loopback)")
	t.eq(M.available("http://localhost:4200"), true, "localhost")
	t.eq(M.available("http://[::1]:4200"), true, "IPv6 loopback")
	t.eq(M.available("http://10.0.0.5:4200"), false, "another machine's node: disabled")
	t.eq(M.available("https://192.168.1.20:4443"), false, "through a :4443 TLS front proxy: disabled")


func test_result_text() -> void:
	t.eq(M.result_text({"ok": true, "data": {"ok": true, "note": "Terminal opened on the box screen — finish there."}}),
		"Terminal opened on the box screen — finish there.", "the server's note")
	t.eq(M.result_text({"ok": true, "data": {}}), "Terminal opened on the box screen — finish there.", "default note")
	t.eq(M.result_text({"ok": false, "status": 403, "data": {"error": "Only on the box's own screen (relayed by a proxy)."}}),
		"Password change not started: Only on the box's own screen (relayed by a proxy).", "the refusal is shown")
	t.eq(M.result_text({"ok": false, "error": "timeout"}), "Password change not started: timeout", "transport error")


func test_pane_posts_through_the_nuclear_gate() -> void:
	var src := FileAccess.get_file_as_string("res://features/settings/nuclear_pane.gd")
	t.ok(src.contains("NuclearGate.post(self, OsPw.PATH, OsPw.request_body())"), "posted via NuclearGate.post")
	t.ok(src.contains("_os_pw.disabled = not OsPw.available(Config.origin)"), "disabled off the box")
	t.ok(not src.contains("passwd"), "the pane never runs or names passwd itself")
