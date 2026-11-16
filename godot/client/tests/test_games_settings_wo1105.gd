extends RefCounted
## WO-1105 — Settings ▸ Games: the pure model (games_model.gd) over a server state shaped like GET /api/games/hosting,
## the request bodies of every control, the QR matrix the dialog draws (the same hex rows as the join_qr template),
## the look source "Send to preview" stores, and where the pane sits (its own pane, a row per game, preview only).

const M := preload("res://features/settings/games_model.gd")
var t

## A QR the server would send for http://192.0.2.15:4200/game/rc/ (src/games/games-qr.js, version 3 M).
const RC_ROWS := ["feef2bf8", "82596208", "baec5ae8", "ba41eae8", "ba51eae8", "82f6e208", "feaaabf8", "00142000", "a33d9128",
	"e5a89218", "0b16f9e8", "e18bb200", "03261608", "751e5638", "0f295f48", "6d242b80", "3ab59748", "19d89278", "ef06d908",
	"19f3b200", "cbf6afd0", "00de58e8", "feb90a88", "821da898", "ba449f80", "ba453190", "baff29b8", "82451900", "fe8f9b08"]


static func _row(over := {}) -> Dictionary:
	var r := {"id": "rc", "title": "Stage Sprint RC", "moduleOn": true, "error": null, "open": true, "phase": "lobby",
		"running": false, "safe": false, "players": 2, "spectators": 0, "bots": {"n": 3, "level": "hard", "max": 9,
		"levels": ["easy", "normal", "hard"]}, "main": {"label": "Laps", "value": 3, "min": 1, "max": 20}, "affect": null,
		"joinUrl": "http://192.0.2.15:4200/game/rc/", "qr": {"n": 29, "rows": RC_ROWS}}
	r.merge(over, true)
	return r


static func _state(over := {}) -> Dictionary:
	var st := {"v": 1, "join": {"addresses": [{"ip": "192.0.2.15", "iface": "eno1", "kind": "lan"},
		{"ip": "100.101.245.97", "iface": "tailscale0", "kind": "vpn"}, {"ip": "127.0.0.1", "iface": "lo", "kind": "loopback"}],
		"ip": "192.0.2.15", "iface": "eno1", "kind": "lan", "auto": true, "warning": ""},
		"world": {"id": "world", "title": "Game World", "moduleOn": false, "joinUrl": null, "qr": null},
		"global": {"safe": false, "lights": false, "wall": false, "house": 1, "open": 1, "running": 0}, "games": [_row()]}
	st.merge(over, true)
	return st


func test_status_and_what_may_be_pressed() -> void:
	t.eq(M.status_text(_row()), "lobby · 2 players · 3 bots")
	t.eq(M.status_text(_row({"players": 1, "bots": {"n": 0}, "spectators": 4})), "lobby · 1 player · 4 watching")
	t.eq(M.status_text(_row({"open": false, "phase": "closed"})), "session closed")
	t.eq(M.status_text(_row({"open": false, "phase": "off", "moduleOn": false})), "module off")
	t.eq(M.status_text(_row({"phase": "paused", "running": true})).begins_with("paused"), true)
	var e := M.enabled(_row())
	t.eq([e.session, e.start, e.stop, e.bots, e.main, e.qr], [true, true, false, true, true, true], "lobby: start, bots, main, QR")
	e = M.enabled(_row({"running": true, "phase": "race"}))
	t.eq([e.start, e.stop, e.main], [false, true, false], "racing: stop only, the main number waits for the lobby")
	e = M.enabled(_row({"safe": true}))
	t.eq(e.start, false, "no start while presenter safe")
	e = M.enabled(_row({"open": false, "phase": "closed"}))
	t.eq([e.session, e.start, e.bots, e.main], [true, false, false, false], "closed: open the session first")
	e = M.enabled(_row({"moduleOn": false, "open": false, "joinUrl": null}))
	t.eq([e.module, e.session, e.qr], [true, false, false], "module off: only the module switch")


func test_global_line_and_join() -> void:
	t.eq(M.global_text(_state()), "1 session open, 0 running.")
	t.eq(M.global_text(_state({"global": {"open": 2, "running": 1, "safe": true}})), "2 sessions open, 1 running — everything is PAUSED.")
	t.eq(M.global_text(_state({"global": {"open": 0}})), "No game session is open.")
	t.eq(M.global_text(_state({"games": []})), "No game module is installed on this box.")
	t.eq(M.global_text(null), "Game hosting state unavailable.")
	var j := M.join_info(_state())
	t.eq(j.url, "http://192.0.2.15:4200/game/rc/", "no world → the first open game")
	t.eq(j.text, "Join address: 192.0.2.15 (eno1) — automatic")
	j = M.join_info(_state({"world": {"id": "world", "moduleOn": true, "joinUrl": "http://192.0.2.15:4200/game/world/"}}))
	t.eq(j.url, "http://192.0.2.15:4200/game/world/", "the world landing page first")
	j = M.join_info(_state({"join": {"ip": "100.101.245.97", "iface": "tailscale0", "warning": "VPN address: only phones on that VPN can join."}}))
	t.eq(j.warn, "VPN address: only phones on that VPN can join.")
	t.eq(M.join_info(_state({"join": {"ip": null, "warning": "x"}})).text, "Join address: none")
	var items := M.address_items(_state())
	t.eq(items.map(func(i: Array) -> String: return str(i[0])), ["", "192.0.2.15", "100.101.245.97"], "automatic first, never loopback")
	t.eq(str(items[2][1]), "100.101.245.97 — tailscale0 (VPN)")


func test_qr_matrix_and_dialog() -> void:
	var m := M.qr_matrix({"n": 29, "rows": RC_ROWS})
	t.eq(m.n, 29)
	t.eq(m.dark.size(), 29 * 29)
	# finder pattern: top-left 7 × 7 ring (row 0 all dark, row 1 dark-light×5-dark), as the template draws it
	var row0 := []
	var row1 := []
	for c in 7:
		row0.append(m.dark[c])
		row1.append(m.dark[29 + c])
	t.eq(row0, [1, 1, 1, 1, 1, 1, 1])
	t.eq(row1, [1, 0, 0, 0, 0, 0, 1])
	t.eq(m.dark[7], 0, "the separator")
	t.eq(m.dark[28 * 29], 1, "bottom-left finder")
	t.eq(M.qr_matrix({"n": 29, "rows": RC_ROWS.slice(1)}).n, 0, "a short payload is refused")
	t.eq(M.qr_matrix(null).n, 0)
	var d := M.qr_dialog(_row())
	t.eq([d.title, d.url, d.n, d.ok], ["Stage Sprint RC", "http://192.0.2.15:4200/game/rc/", 29, true])
	t.eq(M.qr_dialog(_row({"joinUrl": null, "qr": null})).ok, false)


func test_preview_look_source() -> void:
	var s := M.qr_source(_row())
	t.eq([s.type, s.value, s.label], ["template", "join_qr", "Join QR — Stage Sprint RC"])
	t.eq(s.data, {"title": "Stage Sprint RC", "url": "http://192.0.2.15:4200/game/rc/", "n": 29, "rows": RC_ROWS, "game": "rc"})
	var looks := [{"id": "a", "layers": [{"source": {"type": "media", "value": "x"}}]},
		{"id": "b", "layers": [{"source": {"type": "template", "value": "join_qr", "data": {"game": "sk"}}}]},
		{"id": "c", "layers": [{"source": {"type": "template", "value": "join_qr", "data": {"game": "rc"}}}]}]
	t.eq(str(M.find_qr_look(looks, "rc").get("id", "")), "c", "the stored look of that game is reused")
	t.eq(M.find_qr_look(looks, "salad"), {})
	var q := FileAccess.get_file_as_string("res://features/settings/games_qr.gd")
	t.ok(q.contains("\"target\": \"preview\""), "Send to preview stages on PRV")
	t.ok(not q.contains("\"program\"") and not q.contains("take-to-program"), "nothing goes to program from here")


func test_request_bodies() -> void:
	t.eq(M.body_module("world", true), {"action": "module", "game": "world", "on": true})
	t.eq(M.body_session("rc", false), {"action": "session", "game": "rc", "open": false})
	t.eq(M.body_start("sk", true), {"action": "start", "game": "sk"})
	t.eq(M.body_start("sk", false), {"action": "stop", "game": "sk"})
	t.eq(M.body_bots("salad", 2), {"action": "bots", "game": "salad", "n": 2})
	t.eq(M.body_bots("salad", 2, "easy"), {"action": "bots", "game": "salad", "n": 2, "level": "easy"})
	t.eq(M.body_main("rc", 5), {"action": "main", "game": "rc", "value": 5})
	t.eq(M.body_affect("rc", "soft"), {"action": "affect", "game": "rc", "mode": "soft"})
	t.eq(M.body_global("safe", true), {"action": "safe", "on": true})
	t.eq(M.body_global("house", 1.7), {"action": "house", "level": 1.0})
	t.eq(M.error_text({"data": {"error": "no track"}}), "no track")
	t.eq(M.error_text({"error": ""}), "The request failed.")


func test_pane_is_its_own_and_rows_update_in_place() -> void:
	var tab := FileAccess.get_file_as_string("res://features/settings/settings_tab.gd")
	t.ok(tab.contains("_pane(\"Games\").add_child(GamesPane.new())"), "Games is a pane of its own")
	var pane := FileAccess.get_file_as_string("res://features/settings/games_pane.gd")
	t.ok(pane.contains("Ws.on(\"games:hosting\""), "the server's broadcast updates it (web host page changes too)")
	t.ok(pane.contains("if not _by_id.has(gid):"), "a row is built once per game, then updated in place")
	for path in ["games_pane.gd", "games_row.gd", "games_model.gd", "games_qr.gd"]:
		var n := FileAccess.get_file_as_string("res://features/settings/" + path).split("\n").size()
		t.ok(n <= 500, "%s ≤ 500 lines (%d)" % [path, n])
