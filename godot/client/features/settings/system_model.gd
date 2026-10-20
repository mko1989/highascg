extends RefCounted
## WO-608 — pure helpers for Settings → System and DeckLink (web settings-modal-mount-hardware*.js).


## Web formatBytes; lsblk sizes already arrive as text ("953.9G") and pass through (the web printed "NaN GB").
static func fmt_bytes(v: Variant) -> String:
	if v == null:
		return "—"
	if v is String:
		return v if v != "" else "—"
	var b := float(v)
	if b < 1024.0:
		return "%d B" % int(b)
	for u in [["KB", 1024.0], ["MB", 1048576.0], ["GB", 1073741824.0]]:
		if b < u[1] * 1024.0 or u[0] == "GB":
			return "%.1f %s" % [b / u[1], u[0]]
	return ""


static func uptime(sec: Variant) -> String:
	var s := int(sec) if sec != null else 0
	return "%dd %dh %dm" % [s / 86400, (s % 86400) / 3600, (s % 3600) / 60]


static func operator_line(od: Variant) -> String:
	if not (od is Dictionary):
		return "Operator display unknown."
	var bits: Array = [_or(od.get("summary"), "Operator display unknown.")]
	var allow: Variant = od.get("interactiveAllowance")
	if allow is Array and not allow.is_empty():
		bits.append("Interactive Caspar heads (also allowed when confining): %s." % ", ".join(PackedStringArray(allow)))
	if od.get("confineActive") == true:
		bits.append("Pointer confine: active.")
	elif od.get("confineDesired") == true:
		bits.append("Pointer confine: enabled on operator GPU port (Device View).")
	return " ".join(PackedStringArray(bits))


## [[title, [[label, value], …]], …] — the web renderHardwareSummary sections, in its order.
static func hardware_sections(hw: Dictionary) -> Array:
	var out: Array = []
	var cpu: Dictionary = _d(hw.get("cpu"))
	if cpu.has("error"):
		out.append(["Processor", [["Status", str(cpu.error)]]])
	elif not cpu.is_empty():
		out.append(["Processor", [["Model", _or(cpu.get("modelName"), "—")], ["Cores", _or(cpu.get("cores"), "—")],
			["Load (1/5/15)", "%.1f/%.1f/%.1f" % [float(cpu.get("load1", 0)), float(cpu.get("load5", 0)),
				float(cpu.get("load15", 0))]]]])
	var mem: Dictionary = _d(hw.get("memory"))
	if mem.has("error"):
		out.append(["Memory", [["Status", str(mem.error)]]])
	elif not mem.is_empty():
		out.append(["Memory", [["Usage", "%s / %s" % [fmt_bytes(mem.get("usedBytes")), fmt_bytes(mem.get("totalBytes"))]]]])
	var disks: Variant = hw.get("disks")
	if disks is Array and not disks.is_empty():
		var rows: Array = []
		for d in disks:
			if d is Dictionary:
				rows.append([_or(d.get("name"), "?"), str(d.error) if d.has("error") else "%s · %s · %s" % [
					fmt_bytes(d.get("size")), _or(d.get("type"), "—"), _or(d.get("mountpoint"), "(not mounted)")]])
		out.append(["Storage devices", rows])
	var gpu: Dictionary = _d(hw.get("gpu"))
	var g: Array = []
	var nv: Dictionary = _d(gpu.get("nvidia"))
	if nv.has("error"):
		g.append(["NVIDIA GPU", str(nv.error)])
	elif not nv.is_empty():
		g.append_array([["Name", _or(nv.get("name"), "—")], ["Driver", _or(nv.get("driver"), "—")],
			["VRAM", _or(nv.get("vramMiB"), "—")]])
	var ports: Variant = gpu.get("displayPorts")
	if ports is Array and not ports.is_empty():
		var p: PackedStringArray = []
		for dp in ports:
			if dp is Dictionary:
				p.append("%s (%s)%s" % [_or(dp.get("type"), "?"), _or(dp.get("name"), "?"), " ✓" if dp.get("connected") == true else ""])
		g.append(["Display ports", ", ".join(p)])
	if not g.is_empty():
		out.append(["Graphics", g])
	var dl: Dictionary = _d(hw.get("decklink"))
	if dl.has("error"):
		out.append(["DeckLink", [["Status", str(dl.error)]]])
	elif dl.get("devices") is Array and not dl.devices.is_empty():
		out.append(["DeckLink devices", dl.devices.map(func(d: Variant) -> Array:
			return ["#%s" % _or(_d(d).get("index"), "?"), _or(_d(d).get("label"), "")])])
	var au: Dictionary = _d(hw.get("audio"))
	if not au.is_empty() and not au.has("error"):
		var a: Array = [["Count", _or(au.get("deviceCount"), "0")]]
		if au.get("devices") is Array:
			for d in au.devices:
				a.append(["", "%s (%s)" % [_or(_d(d).get("name"), "?"), _or(_d(d).get("type"), "?")]])
		out.append(["Audio devices", a])
	var net: Dictionary = _d(hw.get("network"))
	if not net.is_empty() and not net.has("error"):
		var n: Array = [["Hostname", _or(net.get("hostname"), "—")]]
		if net.get("interfaces") is Array:
			for i in net.interfaces:
				var addr: Variant = _d(i).get("address")
				n.append(["", "%s %s" % [_or(_d(i).get("name"), "?"), "(%s)" % addr if addr else "(no IPv4)"]])
		out.append(["Network", n])
	var sys: Dictionary = _d(hw.get("system"))
	if not sys.is_empty() and not sys.has("error"):
		out.append(["System", [["OS", _or(sys.get("osRelease"), "—")], ["Kernel", _or(sys.get("kernel"), "—")],
			["Uptime", uptime(sys.get("uptimeSec"))]]])
	return out


## "Tue 2026-07-14 10:27:20 UTC" → {date, time}; {} when it does not parse.
static func parse_now(now: Variant) -> Dictionary:
	var parts := str(now if now != null else "").split(" ", false)
	if parts.size() < 3 or not parts[1].contains("-") or not parts[2].contains(":"):
		return {}
	return {"date": parts[1], "time": parts[2]}


## Web Set-time rule: H:MM, HH:MM or HH:MM:SS (24 h) → "HH:MM:SS"; "" when invalid.
static func normalize_time(text: String) -> String:
	var re := RegEx.create_from_string("^([01]?\\d|2[0-3]):([0-5]\\d)(?::([0-5]\\d))?$")
	var m := re.search(text.strip_edges())
	if m == null:
		return ""
	return "%s:%s:%s" % [m.get_string(1).pad_zeros(2), m.get_string(2), m.get_string(3) if m.get_string(3) != "" else "00"]


static func valid_date(text: String) -> bool:
	return RegEx.create_from_string("^\\d{4}-\\d{2}-\\d{2}$").search(text.strip_edges()) != null


## GET /api/system/decklink → summary text (one line per card).
static func decklink_lines(r: Dictionary) -> String:
	var devs: Variant = r.get("devices")
	if not (devs is Array) or devs.is_empty():
		return "No DeckLink devices discovered yet (ffmpeg + recent Caspar log)."
	var rows: PackedStringArray = []
	for d in devs:
		var line := "#%s %s" % [_or(_d(d).get("index"), "?"), _or(_d(d).get("label"), "")]
		var ref: Variant = _d(d).get("externalRef")
		if ref != null and str(ref) != "":
			line += "    Caspar externalRef=%s" % str(ref)
		rows.append(line)
	return "\n".join(rows)


## "Started: x" / "Raised existing window." — the web guiLaunch status text.
static func launch_note(d: Dictionary) -> String:
	if d.get("raised") == true:
		return "Raised existing window."
	return "Started: %s" % str(d.exe) if d.get("exe") else "Started."


static func _d(v: Variant) -> Dictionary:
	return v if v is Dictionary else {}


## JSON numbers arrive as floats — whole ones print without ".0".
static func _or(v: Variant, fallback: String) -> String:
	if v is float and v == floorf(v):
		return str(int(v))
	return fallback if v == null or str(v) == "" else str(v)
