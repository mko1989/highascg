extends RefCounted
## WO-770 — the VR session dialog's text and buttons for each /api/vr/status (vr_session_model.gd), the desktop
## mirror's render size (xr_walk_model.gd), and the Previs toolbar's "VR…".

const M := preload("res://features/previs/xr/vr_session_model.gd")
const Walk := preload("res://features/previs/xr/xr_walk_model.gd")
var t


func _s(over: Dictionary) -> Dictionary:
	var s := {"installed": true, "serverRunning": true, "headsetConnected": false, "sessionRunning": false,
		"pairingEnabled": false, "pin": "", "paired": ["Oculus Quest 3"], "systemName": "", "clientRunning": true,
		"starting": false, "error": ""}
	s.merge(over, true)
	return s


func test_not_installed_and_idle() -> void:
	var v := M.view({"installed": false})
	t.ok(str(v.state).contains("not installed"), "no WiVRn: says so")
	t.ok(not v.start and not v.pair and not v.end, "and offers nothing")
	v = M.view(_s({"serverRunning": false, "clientRunning": false}))
	t.eq(v.state, "No VR session", "idle")
	t.ok(v.start and not v.pair and not v.end, "idle: only Start")


func test_pin_and_waiting() -> void:
	var v := M.view(_s({"pairingEnabled": true, "pin": "482913", "paired": []}))
	t.eq(v.pin, "482913", "the PIN shows while pairing is on")
	t.ok(str(v.detail).contains("PIN"), "and the detail says where it goes")
	t.ok(v.pair and v.end and not v.start, "client up: Pair + End, no second Start")
	t.eq(M.view(_s({"pin": "482913"})).pin, "", "a stale PIN with pairing off is not shown")
	t.ok(str(M.view(_s({})).detail).contains("Oculus Quest 3"), "a paired headset is named")
	t.ok(str(M.view(_s({"paired": []})).detail).contains("Pair a new headset"), "none paired: points at Pair")


func test_connected_and_errors() -> void:
	var v := M.view(_s({"headsetConnected": true, "systemName": "Meta Quest 3"}))
	t.eq(v.state, "Headset connected — Meta Quest 3", "connected with its name")
	t.ok(str(v.detail).contains("VR window"), "the VR window mirrors the headset")
	v = M.view(_s({"headsetConnected": true, "clientRunning": false}))
	t.ok(v.start, "client closed while WiVRn runs: Start opens it again")
	t.ok(str(M.view(_s({"error": "boom"})).detail).ends_with("⚠ boom"), "errors show")
	t.ok(not M.view(_s({"starting": true})).pair, "no Pair while starting")


func test_desk_panel_wo792() -> void:
	var desk := {"available": true, "magicqRunning": false, "error": ""}
	var v := M.view(_s({"desk": desk}))
	t.ok(v.desk, "WiVRn up + WayVR and MagicQ installed: the MagicQ toggle shows")
	t.eq([v.desk_text, v.desk_path], ["MagicQ in VR", "/api/vr/desk/start"], "off: opens it")
	desk.magicqRunning = true
	v = M.view(_s({"desk": desk}))
	t.eq([v.desk_text, v.desk_path], ["Close MagicQ in VR", "/api/vr/desk/stop"], "on: closes it")
	v = M.view(_s({"desk": {"available": true, "pending": true}}))
	t.eq(v.desk_path, "/api/vr/desk/stop", "waiting for the headset: Close cancels")
	t.ok(str(v.detail).contains("once you have the headset on"), "and the detail says MagicQ is waiting")
	t.ok(not M.view(_s({"serverRunning": false, "clientRunning": false, "desk": desk})).desk, "no session: no toggle")
	t.ok(not M.view(_s({"desk": {"available": false}})).desk, "not installed: no toggle")
	t.ok(not M.view(_s({})).desk, "an older server without `desk`: no toggle")
	desk.error = "MagicQ is already running on the desktop"
	t.ok(str(M.view(_s({"desk": desk})).detail).ends_with("⚠ MagicQ is already running on the desktop"), "its error shows")


func test_mirror_px() -> void:
	t.eq(Walk.mirror_px(Vector2(1920, 1080)), Vector2i(1280, 720), "capped at 1280×720")
	t.eq(Walk.mirror_px(Vector2(800, 400)), Vector2i(800, 400), "smaller hosts render 1:1")
	t.eq(Walk.mirror_px(Vector2(2560, 720)), Vector2i(1280, 360), "keeps the host's aspect")
	t.eq(Walk.mirror_px(Vector2.ZERO), Vector2i(640, 360), "unsized host: a default until resized")


func test_hooks() -> void:
	var tab := FileAccess.get_file_as_string("res://features/previs/previs_tab.gd")
	t.ok(tab.contains('preload("res://features/previs/xr/vr_session_dialog.gd").toolbar_button()'), "VR… in the Previs toolbar")
	var walk := FileAccess.get_file_as_string("res://features/previs/xr/xr_walk.gd")
	t.ok(walk.contains("_mirror.global_transform = _cam.global_transform"), "the mirror follows the headset each frame")
	t.ok(walk.contains("vp.world_3d = get_viewport().find_world_3d()"), "on the stage's own world")
