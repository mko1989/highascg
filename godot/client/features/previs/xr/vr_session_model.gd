extends RefCounted
## WO-770 — what the VR session dialog says for a GET /api/vr/status reply (pure, tested): the state line, the PIN
## (big, while pairing is on), the detail line and which buttons apply. WiVRn runs only for a session (owner 25.10:
## "dont start the vr service at login. only when needed"): Start brings it and the VR client up, End takes both down.


## s: the status reply ({installed, serverRunning, headsetConnected, sessionRunning, pairingEnabled, pin, paired,
## systemName, clientRunning, starting, error, desk?}). → {state, pin, detail, start, pair, end, desk, desk_text,
## desk_path}. WO-792: `desk` (src/vr/vr-desk-panel.js) — the MagicQ toggle shows while WiVRn runs and both WayVR and
## MagicQ are installed.
static func view(s: Dictionary) -> Dictionary:
	var v := {"state": "", "pin": "", "detail": "", "start": false, "pair": false, "end": false,
		"desk": false, "desk_text": "", "desk_path": ""}
	if not s.get("installed", false):
		v.state = "WiVRn is not installed on this server"
		v.detail = "Install wivrn-server (help: VR walk) to stream the Previs stage to a Quest headset."
		return v
	var server: bool = s.get("serverRunning", false)
	var client: bool = s.get("clientRunning", false)
	var paired: Array = s.get("paired", []) if s.get("paired") is Array else []
	if s.get("pairingEnabled", false):
		v.pin = str(s.get("pin", ""))
	if s.get("starting", false):
		v.state = "Starting the VR session…"
	elif not server:
		v.state = "No VR session"
		v.detail = "Start a session, then open WiVRn on the headset and connect to this server (USB or Wi-Fi)."
		v.start = true
	elif s.get("headsetConnected", false):
		var name := str(s.get("systemName", ""))
		v.state = "Headset connected" + (" — %s" % name if name != "" else "")
		v.detail = "The VR window shows what the headset sees." if client \
			else "The VR client is not running — Start opens it again."
		v.start = not client
	else:
		v.state = "Waiting for the headset"
		if v.pin != "":
			v.detail = "On the headset: WiVRn → this server → Connect, then enter the PIN."
		elif paired.is_empty():
			v.detail = "No headset is paired yet — Pair a new headset shows a PIN."
		else:
			v.detail = "On the headset: WiVRn → this server → Connect (paired: %s)." % ", ".join(paired)
		v.start = not client
	v.pair = server and not s.get("starting", false)
	v.end = server or client
	var desk: Dictionary = s.get("desk") if s.get("desk") is Dictionary else {}
	if server and desk.get("available", false) and not s.get("starting", false):
		var on: bool = desk.get("magicqRunning", false) or desk.get("pending", false)
		v.desk = true
		if desk.get("pending", false):
			v.detail = (v.detail + "\n" if v.detail != "" else "") + "MagicQ opens in the headset once it is connected."
		v.desk_text = "Close MagicQ in VR" if on else "MagicQ in VR"
		v.desk_path = "/api/vr/desk/stop" if on else "/api/vr/desk/start"
	var err := str(s.get("error", ""))
	if str(desk.get("error", "")) != "":
		err = (err + "\n⚠ " if err != "" else "") + str(desk.error)
	if err != "":
		v.detail = (v.detail + "\n" if v.detail != "" else "") + "⚠ " + err
	return v
