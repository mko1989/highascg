extends RefCounted
## WO-608 — Settings → Updates texts (web settings-modal-system-updates.js): GET /api/system/version,
## /api/system/update/check, /api/system/update/status.


static func stamp(ver: Dictionary) -> String:
	var s := str(ver.get("buildStamp", ""))
	return s if s != "" else (str(ver.get("packageVersion", "")) if str(ver.get("packageVersion", "")) != "" else "(unknown)")


static func volumes(ver: Dictionary) -> String:
	var v: Dictionary = ver.get("volumes", {}) if ver.get("volumes") is Dictionary else {}
	var usb: Dictionary = v.get("usb", {}) if v.get("usb") is Dictionary else {}
	var bridge: Dictionary = v.get("bridge", {}) if v.get("bridge") is Dictionary else {}
	var bits: Array = []
	bits.append("USB drop: %s (applied %s)" % [_or_dash(usb.get("dropStamp")), _or_dash(usb.get("appliedStamp"))]
		if usb.get("mounted") == true else "USB exFAT: not mounted")
	bits.append("Bridge drop: %s" % _or_dash(bridge.get("dropStamp")) if bridge.get("mounted") == true else "Bridge: not mounted")
	if ver.get("retainDrop") == true:
		bits.append("retain mode")
	return " · ".join(bits)


static func check_line(chk: Dictionary) -> String:
	if _s(chk.get("error")) != "":
		return "GitHub check failed: %s" % _s(chk.error)
	if _s(chk.get("latest")) == "":
		return "No highascg-server_*.tar.gz asset on the latest release."
	return "Latest: %s — %s%s" % [str(chk.latest), "update available" if chk.get("updateAvailable") == true else "up to date",
		" (cached)" if chk.get("cached") == true else ""]


static func can_apply(chk: Dictionary) -> bool:
	return chk.get("updateAvailable") == true and _s(chk.get("error")) == ""


static func status_log(st: Dictionary) -> String:
	var lines: Array = ["Phase: %s" % str(st.get("phase", "?"))]
	if st.get("log") is Array:
		lines.append_array((st.log as Array).map(func(l: Variant) -> String: return str(l)))
	if _s(st.get("error")) != "":
		lines.append("ERROR: %s" % str(st.error))
	if _s(st.get("runningStamp")) != "":
		lines.append("Running stamp: %s" % str(st.runningStamp))
	return "\n".join(lines)


static func _or_dash(v: Variant) -> String:
	return "—" if _s(v) == "" else str(v)


## JSON null → "" (str(null) is "<null>").
static func _s(v: Variant) -> String:
	return "" if v == null else str(v)
