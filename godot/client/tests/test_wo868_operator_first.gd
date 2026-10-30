extends RefCounted
## WO-868 — the "Operator GUI first" check on the Caspar server page: operator_first_model.gd (items, confirm text from
## the server's dry run) and server_flow.gd's request sequence (GET state; dry run → confirm → switch with the long
## apply timeout; refusals and a cancelled confirm send nothing).

const OF := preload("res://features/devices/operator_first_model.gd")
const M := preload("res://features/devices/server_page_model.gd")
const FLOW := preload("res://features/devices/server_flow.gd")
const ApiScript := preload("res://core/api_timeouts.gd")
var t

## The box's dry run on 30.10 (POST /api/system/operator-first {enable: true}), trimmed.
const PLAN := {"enable": true, "noop": false, "refusals": [], "warnings": [],
	"channels": {"before": [{"ch": 1, "role": "pgm", "label": "PGM Screen 1"}, {"ch": 2, "role": "prv", "label": "PRV Screen 1"},
		{"ch": 3, "role": "pgm", "label": "PGM Screen 2"}, {"ch": 4, "role": "prv", "label": "PRV Screen 2"},
		{"ch": 5, "role": "operator_gui", "label": "Operator GUI"}, {"ch": 6, "role": "decklink", "label": "DeckLink 1"},
		{"ch": 8, "role": "monitor", "label": "Monitor / headphones"}]},
	"remap": {"1": 2, "2": 3, "3": 4, "4": 5, "5": 1, "6": 6, "7": 7, "8": 8},
	"config": {"slices": [], "references": 0},
	"persistence": {"keys": ["programLayerBankByChannel", "liveScenesByProgramChannel"], "references": 6},
	"projects": {"files": 128, "stamped": 127, "renumbered": 10, "references": 22, "unreadable": 1},
	"layout": {"before": [{"kind": "screen", "n": 1, "sysId": "DP-0", "x": 0}, {"kind": "operator_gui", "n": 1, "sysId": "DP-4", "x": 3840}],
		"after": [{"kind": "operator_gui", "n": 1, "sysId": "DP-4", "x": 0}, {"kind": "screen", "n": 1, "sysId": "DP-0", "x": 1920}]},
	"external": ["REST / AMCP scripts that address a channel by number"]}


class FakeIo:
	extends RefCounted
	var get_reply := {"ok": true, "data": {"enabled": false, "refusals": [], "warnings": []}, "error": ""}
	var dry := {}
	var switch_reply := {"ok": true, "dryRun": false, "backupDir": "/b", "apply": {"status": 200}}
	var calls := []
	var answer := true
	var status_text := ""
	var status_ok := false

	func get_json(path: String) -> Dictionary:
		calls.append(["GET", path])
		return get_reply.duplicate(true)

	func post_json(path: String, body: Variant, timeout_s := 0.0) -> Dictionary:
		calls.append(["POST", path, body.duplicate(true), timeout_s])
		return {"ok": true, "data": (dry if body.get("dryRun") == true else switch_reply).duplicate(true), "error": ""}

	func confirm(text: String) -> bool:
		calls.append(["CONFIRM", text])
		return answer

	func reload() -> void:
		calls.append(["LOAD"])

	func dirty() -> void:
		pass

	func status(text: String, ok: bool) -> void:
		status_text = text
		status_ok = ok

	func toast(_text: String, _type: String) -> void:
		pass

	func changed() -> void:
		pass


func _flow(io: FakeIo) -> Variant:
	return FLOW.new({}, {}, io, "standalone")


func _check(items: Array) -> Dictionary:
	for it in items:
		if it.t == "check" and it.key == "operator_first":
			return it
	return {}


func test_items_states() -> void:
	var s := {}
	OF.init_state(s)
	t.eq(_check(OF.items(s)).disabled, true, "unknown (no GET yet / old server): disabled")
	OF.apply_get(s, {"ok": false, "data": null, "error": "HTTP 404: Not found"})
	t.ok(str(OF.items(s)[2].text).begins_with("Not available on this server"), "old server: says so")
	OF.apply_get(s, {"ok": true, "data": {"enabled": false, "refusals": []}, "error": ""})
	var it := _check(OF.items(s))
	t.eq([it.checked, it.disabled, OF.items(s)[2].text], [false, false, OF.HINT_OFF], "off: enabled check + what it does")
	OF.apply_get(s, {"ok": true, "data": {"enabled": true, "refusals": []}, "error": ""})
	t.eq([_check(OF.items(s)).checked, OF.items(s)[2].text], [true, OF.HINT_ON], "on")
	OF.apply_get(s, {"ok": true, "data": {"enabled": false, "refusals": [{"code": "no_operator_gui", "message": "No Operator GUI destination."}]}, "error": ""})
	t.eq([_check(OF.items(s)).disabled, OF.items(s)[2].text, OF.items(s)[2].tone], [true, "No Operator GUI destination.", "warn"], "refused: disabled + why")
	OF.apply_get(s, {"ok": true, "data": {"enabled": false, "refusals": [{"code": "on_air", "forceable": true, "message": "x"}]}, "error": ""})
	t.eq(_check(OF.items(s)).disabled, false, "on-air is forceable: the confirm asks instead")


func test_only_the_client_page_shows_the_switch() -> void:
	var s := M.init_state({}, {}, "standalone")
	t.eq(_check(M.items(s, 0.0, true)).is_empty(), false, "client page (network_panel) has the check")
	t.eq(_check(M.items(s, 0.0, false)).is_empty(), true, "the web golden replay page is unchanged")


func test_confirm_text_lists_moves_monitors_and_stores() -> void:
	var tx := OF.confirm_text(PLAN, true)
	for want in ["Turn Operator GUI first on?", "PGM Screen 1: 1 → 2", "PRV Screen 2: 4 → 5", "Operator GUI: 5 → 1",
			"Operator GUI (DP-4): x 3840 → 0", "Screen 1 (DP-0): x 0 → 1920", "Projects: 10 renumbered, 127 stamped (128 files)",
			"Saved state: programLayerBankByChannel, liveScenesByProgramChannel", "Check outside HighAsCG:\n- REST / AMCP", "Caspar restarts now."]:
		t.ok(tx.contains(want), "confirm text has: " + want)
	t.ok(not tx.contains("DeckLink 1:"), "unmoved channels are not listed")
	t.ok(OF.confirm_text(PLAN, false).begins_with("Turn Operator GUI first off?"), "off wording")


func test_flow_switch_sequence() -> void:
	var io := FakeIo.new()
	io.dry = PLAN.duplicate(true)
	var f: Variant = _flow(io)
	await f.refresh_operator_first()
	t.eq(f.s.op_first, false, "GET read")
	io.calls = []
	await f.set_operator_first(true)
	t.eq(io.calls.map(func(c: Array) -> String: return c[0]), ["POST", "CONFIRM", "POST", "GET", "LOAD"], "dry run, confirm, switch, re-read, reload")
	t.eq(io.calls[0][2], {"enable": true, "dryRun": true}, "dry run body")
	t.eq(io.calls[2][2], {"enable": true, "dryRun": false, "force": false}, "switch body")
	t.eq(io.calls[2][3], ApiScript.APPLY_TIMEOUT_S, "the switch restarts Caspar: long apply timeout")
	t.eq([io.status_text, io.status_ok], ["Operator GUI first on: channel 1 is the operator GUI — Caspar config written", true], "status")
	t.eq(OF.done_text({"ok": true, "apply": null, "applySkipped": "offline_mode"}, false),
		"Operator GUI first off: legacy channel numbers — offline mode: the Caspar config follows on the next apply", "offline mode wording")


func test_flow_cancel_refusal_and_force() -> void:
	var io := FakeIo.new()
	io.dry = PLAN.duplicate(true)
	io.answer = false
	var f: Variant = _flow(io)
	await f.set_operator_first(true)
	t.eq(io.calls.map(func(c: Array) -> String: return c[0]), ["POST", "CONFIRM"], "cancelled: nothing switched")
	io.calls = []
	io.answer = true
	io.dry = PLAN.duplicate(true)
	io.dry.refusals = [{"code": "virtual_main_channels", "message": "Virtual main channels."}]
	await f.set_operator_first(true)
	t.eq(io.calls.size(), 1, "refused: only the dry run")
	t.eq([io.status_text, io.status_ok], ["Virtual main channels.", false], "refusal on the status line")
	io.calls = []
	io.dry.refusals = [{"code": "on_air", "forceable": true, "message": "Program channel(s) 1 carry content."}]
	await f.set_operator_first(true)
	t.ok(str(io.calls[1][1]).contains("Program channel(s) 1 carry content."), "on-air shown in the confirm")
	t.eq(io.calls[2][2].force, true, "confirmed on-air switch sends force")
