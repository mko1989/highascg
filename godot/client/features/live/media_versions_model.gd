extends RefCounted
## WO-592 B / WO-921 — the media-file Versions panel's texts (media_versions.gd), pure so tests can load them.


static func fmt_size(n: float) -> String:
	if n >= 1e9:
		return "%.1f GB" % (n / 1e9)
	if n >= 1e6:
		return "%d MB" % roundi(n / 1e6)
	return "%d kB" % maxi(1, roundi(n / 1e3))


## web fmtDate: DD.MM.YY HH:MM, local time
static func fmt_date(ms: float) -> String:
	if ms <= 0:
		return ""
	var d := Time.get_datetime_dict_from_unix_time(int(ms / 1000.0) + int(Time.get_time_zone_from_system().bias) * 60)
	return "%02d.%02d.%02d %02d:%02d" % [d.day, d.month, d.year % 100, d.hour, d.minute]


## An old version's row text: its name (WO-921; versions stashed before have none) and when it was replaced.
static func old_text(v: Dictionary) -> String:
	var when := "replaced %s" % fmt_date(float(v.get("replacedAt", 0)))
	return "%s · %s" % [str(v.name), when] if str(v.get("name", "")) != "" else when


## The purge confirm names the file too (WO-921), so the operator deletes the version they mean.
static func purge_text(v: Dictionary) -> String:
	var nm := str(v.get("name", ""))
	return "Delete version v%d%s permanently? This cannot be undone." % [int(v.get("v", 0)), " (%s)" % nm if nm != "" else ""]


## WO-921: the new version takes its own name — say so, so the operator knows what the browser and the looks will read.
static func upload_text(base: String, incoming: String) -> String:
	var tail := "Every look plays it." if incoming == base else "The new version keeps its own name: the media list and every look will read \"%s\"." % incoming
	return "Replace \"%s\" with \"%s\"?\n\n%s The current one is kept in the version list." % [base, incoming, tail]
