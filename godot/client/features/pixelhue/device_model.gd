extends RefCounted
## WO-1039 — PixelHue Studio "Device" panel logic, pure: request bodies, validation and labels.
## Bodies match what Studio's public/device*.js sends and lib/studio-device.js, studio-maintenance.js,
## device-extras.js, self-test.js, source-backup.js accept (the server adds the session).

const RESET_KEEPS := [
	["user-data", "Keep network, EDID, files and user data"],
	["network", "Keep network settings only"],
	["nothing", "Erase everything (address -> 192.168.0.10)"],
]
const CAPACITY := ["SL", "DL", "4K"]
const GENLOCK := ["Free-run", "External genlock", "Input"]
const TIME_MIN := 946684800
const TIME_MAX := 4102444800


static func fan_label(v: int) -> String:
	return "Standard" if v == 1 else ("High performance" if v == 2 else "Mode %d" % v)


static func genlock_label(v: int) -> String:
	return GENLOCK[v] if v >= 0 and v < GENLOCK.size() else "Source %d" % v


static func capacity_label(c: int) -> String:
	return CAPACITY[c] if c >= 0 and c < CAPACITY.size() else "Managed"


static func facts(state: Dictionary) -> Array:
	var node: Dictionary = state.get("node", {})
	var dev: Dictionary = state.get("device", {})
	var fw := str(node.get("firmware", ""))
	return [["Model", str(dev.get("model", ""))], ["Serial", str(dev.get("serial", ""))],
		["Firmware", fw if fw != "" else "Unavailable"], ["Address", "%s:%s" % [str(dev.get("host", "")), str(int(dev.get("port", 0)))]]]


# ---- general settings -------------------------------------------------------------------------

## 1-32 UTF-8 bytes, no control characters. "" = fine.
static func validate_name(s: String) -> String:
	var bad := s.strip_edges() == "" or s.to_utf8_buffer().size() > 32
	for i in s.length():
		if s.unicode_at(i) < 32:
			bad = true
	return "Device name must contain 1-32 UTF-8 bytes." if bad else ""


## What the form changed: {name?, beacon?, fanMode?, genlock?{type, sourceId}} (Studio's `changes`).
## form: {name, beacon (-1 = no control), fan (-1), genlock_type (-1), genlock_input}
static func device_changes(node: Dictionary, form: Dictionary) -> Dictionary:
	var out := {}
	if form.has("name") and str(form.name) != str(node.get("name", "")):
		out["name"] = str(form.name)
	if int(form.get("beacon", -1)) >= 0 and int(form.beacon) != int(node.get("beacon", -1)):
		out["beacon"] = int(form.beacon)
	if int(form.get("fan", -1)) >= 0 and int(form.fan) != int(node.get("fanMode", -1)):
		out["fanMode"] = int(form.fan)
	var gl: Dictionary = node.get("genlock", {}) if node.get("genlock") is Dictionary else {}
	var gt := int(form.get("genlock_type", -1))
	if gt >= 0:
		var gi := int(form.get("genlock_input", 0))
		if gt != int(gl.get("type", -1)) or (gt == 2 and gi != int(gl.get("sourceId", -1))):
			out["genlock"] = {"type": gt, "sourceId": gi}
	return out


static func mode_body(workmode: int) -> Dictionary:
	return {"workMode": workmode, "confirmModeChange": true}


static func layer_body(layer_mode: int) -> Dictionary:
	return {"layerMode": layer_mode}


static func layer_text(mode: Dictionary) -> String:
	var bits: Array = []
	if mode.get("main") != null:
		bits.append("%d MAIN layers · %d PIP layers" % [int(mode.main), int(mode.get("pip", 0))])
	if mode.get("hdr") == true:
		bits.append("HDR supported")
	elif mode.get("hdr") == false:
		bits.append("HDR not supported")
	return " · ".join(bits)


# ---- clock ----------------------------------------------------------------------------------

@warning_ignore("integer_division")
static func zone_label(z: Dictionary) -> String:
	var off := int(z.get("offset", 0))
	return "(UTC%s%02d:%02d) %s" % ["-" if off < 0 else "+", absi(off) / 60, absi(off) % 60, str(z.get("name", ""))]


static func zone_offset(zones: Array, value: int) -> int:
	for z in zones:
		if int(z.get("value", -1)) == value:
			return int(z.get("offset", 0))
	return 0


## The device stores UTC seconds; the wall time is that instant in the zone (offset in minutes).
static func wall_time(ts: int, offset: int) -> String:
	var d := Time.get_datetime_dict_from_unix_time(ts + offset * 60)
	return "%04d-%02d-%02d %02d:%02d:%02d" % [d.year, d.month, d.day, d.hour, d.minute, d.second]


## "YYYY-MM-DD HH:MM[:SS]" (or with T) in the zone -> UTC seconds, -1 when it is not a valid time.
static func parse_wall_time(text: String, offset: int) -> int:
	var re := RegEx.new()
	re.compile("^(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{2}):(\\d{2})(?::(\\d{2}))?$")
	var m := re.search(text.strip_edges())
	if m == null:
		return -1
	var d := {"year": int(m.get_string(1)), "month": int(m.get_string(2)), "day": int(m.get_string(3)),
		"hour": int(m.get_string(4)), "minute": int(m.get_string(5)), "second": int(m.get_string(6)) if m.get_string(6) != "" else 0}
	if d.month < 1 or d.month > 12 or d.day < 1 or d.day > 31 or d.hour > 23 or d.minute > 59 or d.second > 59:
		return -1
	var ts := int(Time.get_unix_time_from_datetime_dict(d)) - offset * 60
	return ts if ts >= TIME_MIN and ts <= TIME_MAX else -1


static func clock_body(zone: int, ts: int) -> Dictionary:
	return {"time": {"timezone": zone, "timestamp": ts}}


# ---- electrostatic protection -----------------------------------------------------------------

## {ok, body, error}; the hold time is an integer in the device's limits.
static func anti_static(enable: int, time_text: String, limits: Dictionary) -> Dictionary:
	var lo := int(limits.get("min", 0))
	var hi := int(limits.get("max", 0))
	if not time_text.strip_edges().is_valid_int() or int(time_text) < lo or int(time_text) > hi:
		return {"ok": false, "body": {}, "error": "Hold time must be a whole number from %d to %d ms." % [lo, hi]}
	return {"ok": true, "body": {"antiStatic": {"enable": enable, "time": int(time_text)}}, "error": ""}


# ---- network & maintenance (device-action) ----------------------------------------------------

static func _octets(value: String, label: String) -> Variant:
	var parts := value.strip_edges().split(".")
	var re := RegEx.new()
	re.compile("^(0|[1-9]\\d{0,2})$")
	var sum := 0
	if parts.size() != 4:
		return label + " must be an IPv4 address."
	for p in parts:
		if re.search(p) == null or int(p) > 255:
			return label + " must be an IPv4 address."
		sum = sum * 256 + int(p)
	return sum


## Mirrors studio-maintenance.js validateNetwork. {ok, network, error}.
static func network(dhcp: int, ip: String, mask: String, gateway: String) -> Dictionary:
	if dhcp == 1:
		return {"ok": true, "network": {"dhcp": 1, "ip": "", "netmask": "", "gateway": ""}, "error": ""}
	var a: Variant = _octets(ip, "IP address")
	var m: Variant = _octets(mask, "Subnet mask")
	var g: Variant = _octets(gateway, "Gateway")
	for v in [a, m, g]:
		if v is String:
			return _net_err(v)
	var ia: int = a
	var im: int = m
	var ig: int = g
	var inverse := (~im) & 0xFFFFFFFF
	if im == 0 or ((inverse + 1) & inverse) != 0:
		return _net_err("Subnet mask must be contiguous, e.g. 255.255.255.0.")
	var host := ia & inverse
	if host == 0 or host == inverse:
		return _net_err("IP address cannot be the network or broadcast address.")
	if ((ia ^ ig) & im) != 0:
		return _net_err("Gateway must be in the same subnet as the IP address.")
	if ia == ig:
		return _net_err("IP address and gateway must differ.")
	return {"ok": true, "network": {"dhcp": 0, "ip": ip.strip_edges(), "netmask": mask.strip_edges(), "gateway": gateway.strip_edges()}, "error": ""}


static func _net_err(msg: String) -> Dictionary:
	return {"ok": false, "network": {}, "error": msg}


static func network_action(net: Dictionary) -> Dictionary:
	return {"action": "network", "network": net, "confirm": true}


static func network_confirm(net: Dictionary) -> String:
	var target := "DHCP (the address may change)" if int(net.get("dhcp", 0)) == 1 else str(net.get("ip", ""))
	return "Apply network settings? The device moves to %s and this app may need to reconnect." % target


static func restart_action() -> Dictionary:
	return {"action": "restart", "confirm": true}


static func shutdown_action() -> Dictionary:
	return {"action": "shutdown", "confirm": true}


static func factory_reset_action(keep: String) -> Dictionary:
	return {"action": "factory-reset", "keep": keep, "confirm": "RESET"}


static func keep_label(keep: String) -> String:
	for k in RESET_KEEPS:
		if k[0] == keep:
			return k[1]
	return keep


static func device_name(state: Dictionary) -> String:
	var d: Dictionary = state.get("device", {})
	return "%s %s" % [str(d.get("model", "")), str(d.get("serial", ""))]


## A device-action answer asking the operator to reconnect ({reconnect, host, message}).
static func is_reconnect(r: Dictionary) -> bool:
	return r.get("reconnect") == true


static func card_rows(subcards: Array) -> Array:
	var out: Array = []
	for c in subcards:
		var ports := str(c.get("ports", ""))
		out.append([str(c.get("slot", "")), "%s (%s · model %s)" % [str(c.get("name", "")), str(c.get("kind", "")), str(int(c.get("modelId", 0)))],
			ports if ports != "" else "—", "Offline" if c.get("online") != null and int(c.online) == 0 else "Online"])
	return out


# ---- self-test --------------------------------------------------------------------------------

static func self_test_summary(st: Dictionary) -> String:
	var total := int(st.get("total", 0))
	var bad := int(st.get("abnormal", 0))
	var what := "No result stored." if total == 0 else ("%d of %d checks abnormal" % [bad, total] if bad > 0 else "All %d checks normal" % total)
	return "%s: %s" % ["Device test" if int(st.get("checkType", 0)) == 1 else "Power-on check", what]


## Items of one part, abnormal first (stable otherwise): [[name, value text, ok]].
static func self_test_rows(part: Dictionary) -> Array:
	var rows: Array = []
	for pass_ok in [false, true]:
		for it in part.get("items", []):
			if (it.get("ok") == true) == pass_ok:
				var idx := int(it.get("index", 0))
				var nm := "%s%s" % [str(it.get("name", "")), " %d" % (idx + 1) if idx > 0 else ""]
				rows.append([nm, str(it.get("value", "")) + ("" if pass_ok else " · abnormal"), pass_ok])
	return rows


static func self_test_done(st: Dictionary) -> String:
	var bad := int(st.get("abnormal", 0))
	return "Self-test finished: %d abnormal." % bad if bad > 0 else "Self-test finished: all normal."


# ---- source backup ----------------------------------------------------------------------------

static func backup_enable(on: int) -> Dictionary:
	return {"action": "enable", "enable": on}


static func backup_primary_first(on: bool) -> Dictionary:
	return {"action": "primary-first", "primaryFirst": 1 if on else 0}


static func backup_update_auto(id: int, auto: bool) -> Dictionary:
	return {"action": "update", "id": id, "auto": auto}


static func backup_update_using(id: int, using: String) -> Dictionary:
	return {"action": "update", "id": id, "using": using}


static func backup_remove(id: int) -> Dictionary:
	return {"action": "remove", "id": id}


static func backup_add(primary: int, backup: int) -> Dictionary:
	return {"action": "add", "primary": primary, "backup": backup}


## Inputs not yet in any pair.
static func backup_free(state: Dictionary) -> Array:
	var used := {}
	for p in state.get("pairs", []):
		used[int(p.get("primary", -1))] = true
		used[int(p.get("backup", -1))] = true
	var out: Array = []
	for i in state.get("inputs", []):
		if not used.has(int(i.get("id", -1))):
			out.append(i)
	return out


static func backup_input_label(i: Dictionary) -> String:
	return "%s · %s%s" % [str(i.get("name", "")), capacity_label(int(i.get("capacity", -1))), "" if int(i.get("signal", 0)) != 0 else " · no signal"]


## Free inputs that may back up `primary_id` (same capacity, or not larger).
static func backup_candidates(state: Dictionary, primary_id: int) -> Array:
	var free := backup_free(state)
	var chosen: Dictionary = {}
	for i in free:
		if int(i.id) == primary_id:
			chosen = i
	var out: Array = []
	if chosen.is_empty():
		return out
	var same: bool = state.get("sameCapacity") == true
	for i in free:
		if int(i.id) != primary_id and (int(i.capacity) == int(chosen.capacity) if same else int(i.capacity) <= int(chosen.capacity)):
			out.append(i)
	return out


## "using" choices of a pair: [[value, label]].
static func backup_using_options(pair: Dictionary) -> Array:
	var out: Array = [["primary", "Primary · %s" % str(pair.get("primaryName", ""))], ["backup", "Backup · %s" % str(pair.get("backupName", ""))]]
	if str(pair.get("using", "")) == "none":
		out.append(["none", "None (no signal)"])
	return out


static func backup_idle_note(state: Dictionary) -> String:
	var n: int = (state.get("pairs", []) as Array).size()
	return "%d pair%s stored. Turn backup on to edit pairs." % [n, "" if n == 1 else "s"]
