extends RefCounted
## WO-941 — the DeckLink driver install answers only when dpkg + the DKMS build finish (server caps the script at
## 300 s); with the 15 s default the client reported a successful install as "server did not answer in time".

const ApiScript := preload("res://core/api_timeouts.gd")
var t


func test_install_timeout_outlasts_the_server_cap() -> void:
	t.eq(ApiScript.request_timeout(ApiScript.INSTALL_TIMEOUT_S), 330.0, "install: 330 s")
	t.ok(ApiScript.INSTALL_TIMEOUT_S > 300.0, "longer than the server's 300 s script timeout")


func test_install_post_passes_it_through_the_nuclear_gate() -> void:
	var pane := FileAccess.get_file_as_string("res://features/settings/decklink_pane.gd")
	t.ok(pane.contains("NuclearGate.post(self, \"/api/system/decklink/install\", {}, null, Timeouts.INSTALL_TIMEOUT_S)"),
		"decklink_pane.gd sends the install with the long timeout")
	var gate := FileAccess.get_file_as_string("res://app/nuclear_gate.gd")
	t.eq(gate.count("await to.post_json(path, b, timeout_s)"), 2, "first try and the password retry both use it")
