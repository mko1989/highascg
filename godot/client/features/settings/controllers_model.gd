extends RefCounted
## WO-1066 — pure helpers of Settings ▸ Controllers (GET /api/bluetooth; tests/test_controllers_model.gd).


## The line under the heading.
static func summary(d: Variant) -> String:
	if not (d is Dictionary):
		return "Bluetooth status unavailable."
	if d.get("available") != true:
		return "Bluetooth is not available: %s" % str(d.get("reason", "no adapter"))
	if d.get("powered") != true:
		return "Bluetooth is off."
	var n := 0
	for dev in d.get("devices", []):
		if dev is Dictionary and dev.get("connected") == true:
			n += 1
	var s := "%d controller%s connected." % [n, "" if n == 1 else "s"]
	if d.get("scanning") == true:
		s += " Scanning — hold the controller's pairing buttons (PS4: Share + PS) until its light flashes."
	return s


## What a device row says and offers: {state, actions: [[label, op]]} — op is the POST under /api/bluetooth/.
static func row(dev: Dictionary) -> Dictionary:
	if dev.get("connected") == true:
		return {"state": "Connected", "actions": [["Disconnect", "disconnect"], ["Forget", "forget"]]}
	if dev.get("paired") == true:
		return {"state": "Paired — press its PS / Home button, or Connect", "actions": [["Connect", "connect"], ["Forget", "forget"]]}
	return {"state": "In pairing mode" if dev.get("gamepad", true) != false else "Not a known controller", "actions": [["Pair", "pair"]]}


## The error of a failed POST (body {error} or the transport's), never empty.
static func error_text(res: Dictionary) -> String:
	var d: Variant = res.get("data")
	if d is Dictionary and str(d.get("error", "")) != "":
		return str(d.error)
	var e := str(res.get("error", ""))
	return e if e != "" else "The request failed."
