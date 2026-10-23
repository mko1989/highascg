extends RefCounted
## WO-692 — NIC cards (also a port that is down), the apply body and the Wi-Fi rows.

const M := preload("res://features/settings/network_model.gd")
var t


func test_ipv4() -> void:
	t.ok(M.is_ipv4("192.168.0.23"), "plain")
	t.ok(not M.is_ipv4("192.168.0"), "three parts")
	t.ok(not M.is_ipv4("192.168.0.256"), "octet > 255")
	t.ok(not M.is_ipv4("10.0.0.01"), "leading zero")
	t.ok(not M.is_ipv4("a.b.c.d"), "letters")


func test_card_up_dhcp_primary() -> void:
	var c := M.card({"name": "eno1", "kind": "ethernet", "carrier": true, "mode": "dhcp", "connection": "highascg-eno1",
		"addresses": [{"address": "192.168.0.23", "prefixLength": 24.0}], "static": {"address": "", "prefixLength": 24.0, "dns": []}}, "eno1")
	t.eq(c.title, "eno1 · Ethernet  (primary)", "primary marked")
	t.eq(c.status, "link up · 192.168.0.23/24 · DHCP", "status line")
	t.eq(c.mode, "dhcp", "mode")
	t.eq([c.ip, c.prefix], ["192.168.0.23", "24"], "static fields start from the current address")


func test_card_down_never_set_up() -> void:
	var c := M.card({"name": "enp3s0", "kind": "ethernet", "carrier": false, "mode": "unknown", "connection": null,
		"addresses": [], "static": {"address": "", "prefixLength": 24.0, "dns": []}}, "eno1")
	t.eq(c.title, "enp3s0 · Ethernet", "not primary")
	t.eq(c.status, "no cable · no IPv4 · not set up yet", "a down port is listed and says so")
	t.eq(c.ip, "", "nothing to pre-fill")


func test_card_down_saved_static() -> void:
	var c := M.card({"name": "eno2", "kind": "ethernet", "carrier": false, "mode": "static", "connection": "highascg-eno2",
		"addresses": [], "static": {"address": "2.0.0.13", "prefixLength": 8.0, "gateway": "", "dns": ["1.1.1.1"]}}, "eno1")
	t.eq(c.status, "no cable · no IPv4 · static", "saved profile shown while unplugged")
	t.eq([c.mode, c.ip, c.prefix, c.dns], ["static", "2.0.0.13", "8", "1.1.1.1"], "pre-filled from the profile")


func test_apply_body() -> void:
	t.eq(M.apply_body("eno2", "dhcp", "", "", "", ""), {"body": {"interface": "eno2", "mode": "dhcp"}}, "dhcp")
	t.eq(M.apply_body("eno2", "static", "2.0.0.13", "8", "", ""), {"body": {"interface": "eno2", "mode": "static",
		"static": {"address": "2.0.0.13", "prefixLength": 8, "gateway": "", "dns": []}}}, "static, no gateway")
	t.ok(M.apply_body("eno2", "static", "2.0.0", "8", "", "").has("error"), "bad address")
	t.ok(M.apply_body("eno2", "static", "2.0.0.13", "33", "", "").has("error"), "bad prefix")
	t.ok(M.apply_body("eno2", "static", "2.0.0.13", "8", "x", "").has("error"), "bad gateway")
	t.ok(M.apply_body("", "dhcp", "", "", "", "").has("error"), "no interface")


func test_carries_origin() -> void:
	var c := {"addresses": ["192.168.0.23"]}
	t.ok(M.carries_origin(c, "http://192.168.0.23:4200"), "the GUI talks through this port")
	t.ok(not M.carries_origin(c, "http://127.0.0.1:4200"), "loopback does not")


func test_wifi() -> void:
	var st := {"available": true, "radio": "on", "connected": "Studio", "networks": [
		{"ssid": "Studio", "signal": 70.0, "security": "WPA2", "inUse": true},
		{"ssid": "Guest", "signal": 40.0, "security": "", "inUse": false}]}
	t.eq(M.wifi_rows(st), [["✓ Studio  ·  70%  ·  WPA2", "Studio", true], ["Guest  ·  40%  ·  open", "Guest", false]], "rows")
	t.eq(M.wifi_line(st), "Connected to \"Studio\".", "connected")
	t.eq(M.wifi_line({"available": false}), "No Wi-Fi adapter on this machine.", "no adapter")
	t.eq(M.wifi_line({"available": true, "radio": "off"}), "Wi-Fi is off.", "radio off")
