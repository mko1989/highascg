extends RefCounted
## WO-837 — the Devices tab's Lighting consoles form model: the record it posts, the checks the server repeats, the
## generic OSC templates as typed text, the Test answer line.

const M := preload("res://features/devices/lighting_console_model.gd")
var t


func test_a_plain_console() -> void:
	var r := M.to_record({"name": " FOH ", "kind": "magicq", "host": "192.168.1.20", "port": ""})
	t.ok(r.ok, "valid")
	t.eq(r.record, {"name": "FOH", "kind": "magicq", "host": "192.168.1.20", "port": 8000}, "trimmed, blank port = the kind's default")
	r = M.to_record({"id": "foh", "name": "FOH", "kind": "eos", "host": "eos.local", "port": "9000", "prefix": "ignored"})
	t.eq(r.record, {"id": "foh", "name": "FOH", "kind": "eos", "host": "eos.local", "port": 9000}, "id kept; prefix is grandMA3 only")


func test_grandma3_prefix() -> void:
	t.eq(M.to_record({"name": "MA", "kind": "grandma3", "host": "h", "port": "", "prefix": "gma"}).record.prefix, "gma", "prefix kept")
	t.ok(not M.to_record({"name": "MA", "kind": "grandma3", "host": "h", "prefix": "a/b"}).ok, "no slashes")
	t.ok(not M.to_record({"name": "MA", "kind": "grandma3", "host": "h", "prefix": ""}).record.has("prefix"), "empty prefix is left out")


func test_validation_messages() -> void:
	t.ok(not M.to_record({"name": "", "kind": "magicq", "host": "h"}).ok, "name required")
	t.ok(not M.to_record({"name": "x".repeat(41), "kind": "magicq", "host": "h"}).ok, "name at most 40")
	t.ok(not M.to_record({"name": "a", "kind": "nope", "host": "h"}).ok, "unknown type")
	t.ok(not M.to_record({"name": "a", "kind": "magicq", "host": "bad host!"}).ok, "host characters")
	t.ok(not M.to_record({"name": "a", "kind": "magicq", "host": "h", "port": "70000"}).ok, "port range")
	t.ok(not M.to_record({"name": "a", "kind": "magicq", "host": "h", "port": "80x"}).ok, "port gibberish is refused, not salvaged")
	var osc := M.to_record({"name": "a", "kind": "osc", "host": "h", "port": ""})
	t.ok(not osc.ok and osc.error.contains("required"), "the generic kind has no default port")


func test_generic_osc_templates() -> void:
	var f := {"name": "Desk", "kind": "osc", "host": "10.0.0.5", "port": "7000", "templates": {
		"go": {"address": "/pb/{list}/go", "args": "1"},
		"fader": {"address": "/fader/{fader}", "args": "{level01} 0.5 text"},
		"release": {"address": "", "args": "9"}}}
	var r := M.to_record(f)
	t.ok(r.ok, "valid")
	t.eq(r.record.templates.keys(), ["go", "fader"], "an empty address leaves the action out")
	t.eq(r.record.templates.go, {"address": "/pb/{list}/go", "args": [1]}, "number arg")
	t.eq(r.record.templates.fader.args, ["{level01}", 0.5, "text"], "placeholder stays text, floats stay floats")
	f.templates.go.address = "pb/go"
	t.ok(not M.to_record(f).ok, "address must start with /")
	f.templates.go.address = "/pb go"
	t.ok(not M.to_record(f).ok, "no spaces in an address")
	var back := M.to_form(M.to_record({"name": "Desk", "kind": "osc", "host": "h", "port": "7000", "templates": {"fader": {"address": "/f/{fader}", "args": "{level01} 2"}}}).record)
	t.eq(back.templates.fader, {"address": "/f/{fader}", "args": "{level01} 2"}, "record → form round trip")
	t.eq(back.port, "7000", "port as text")


func test_summary_and_test_line() -> void:
	t.eq(M.summary({"host": "10.0.0.2", "port": 8000.0, "kind": "eos"}), "10.0.0.2:8000 · ETC Eos (OSC)", "list row")
	t.eq(M.test_line({"ok": true, "data": {"ok": true, "sent": ["/eos/ping"], "note": "pinged"}}), "Sent /eos/ping · pinged", "ok")
	t.eq(M.test_line({"ok": false, "data": {"ok": false, "error": "no route to host"}}), "Test failed: no route to host", "server error")
	t.eq(M.test_line({"ok": false, "data": null, "error": "request failed"}), "Test failed: request failed", "transport error")
