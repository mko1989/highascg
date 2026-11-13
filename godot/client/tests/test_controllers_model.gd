extends RefCounted
## WO-1066 — Settings ▸ Controllers model (controllers_model.gd).

const M := preload("res://features/settings/controllers_model.gd")
var t


func test_summary() -> void:
	t.eq(M.summary(null), "Bluetooth status unavailable.")
	t.ok(M.summary({"available": false, "reason": "bluetoothctl is not installed (sudo apt install bluez)"}).contains("apt install bluez"), "says what is missing")
	t.eq(M.summary({"available": true, "powered": false}), "Bluetooth is off.")
	var d := {"available": true, "powered": true, "scanning": false, "devices": [{"connected": true}, {"connected": false}]}
	t.eq(M.summary(d), "1 controller connected.")
	d["scanning"] = true
	t.ok(M.summary(d).contains("Share + PS"), "scanning: how to put a pad in pairing mode")
	t.eq(M.summary({"available": true, "powered": true, "devices": []}), "0 controllers connected.")


func test_rows() -> void:
	t.eq(M.row({"connected": true, "paired": true}).actions, [["Disconnect", "disconnect"], ["Forget", "forget"]])
	t.eq(M.row({"connected": false, "paired": true}).actions, [["Connect", "connect"], ["Forget", "forget"]])
	t.eq(M.row({"connected": false, "paired": false}).actions, [["Pair", "pair"]], "a new controller: one step")


func test_error_text() -> void:
	t.eq(M.error_text({"ok": false, "data": {"error": "not in range"}, "error": "HTTP 409"}), "not in range")
	t.eq(M.error_text({"ok": false, "data": null, "error": "HTTP 502"}), "HTTP 502")
	t.eq(M.error_text({"ok": false}), "The request failed.")
