extends RefCounted
## WO-918 — the pure half of devices_follow.gd (no autoloads, so it tests headless).

const ThemeBuilder := preload("res://app/theme_builder.gd")
const WARN_PREFIX := "Display layout not applied: "


## F5: these broadcasts mean another project (or rig) is now the live one.
static func clears_status(path: String, value: Variant) -> bool:
	return path == "project.activated" or (path == "hardwareConfig" and value is Dictionary and value.get("applied") == true)


## WO-919 F13: the local Settings reloaded (header _adopt after a Load / New) — refresh the shown tab when it shows this
## machine (an edited peer's planned map is its own settings, not the local autoload).
static func refresh_on_settings_loaded(editing: String, visible: bool) -> bool:
	return editing == "" and visible


## F1: project-activate.js broadcasts the same `restartRequired` the load reply carries.
static func restart_on_activate(path: String, value: Variant) -> bool:
	return path == "project.activated" and value is Dictionary and value.get("restartRequired") == true


## F1 (New project): the state's configComparison says the running Caspar differs from what the module now expects.
## Unknown (not connected, no data) is not a mismatch.
static func misaligned(comparison: Variant) -> bool:
	return comparison is Dictionary and comparison.get("aligned") == false and bool(comparison.get("serverChannelCount"))


## F3: "" when the apply reply is fine (a missing layoutOk counts as true), else the line to show in warn colour.
static func layout_warning(data: Variant) -> String:
	if not data is Dictionary or data.get("layoutOk") != false:
		return ""
	var why := str(data.get("layoutProblem", "")).strip_edges()
	if why.begins_with("Display layout"):  # full-config-apply.js already words it as a sentence
		return why
	return WARN_PREFIX + (why if why != "" else "the layout check failed (see the server log)")


## The toolbar status colour: red failed, amber done-but-not-what-was-asked (F3), green otherwise.
static func status_color(ok: bool, warn: bool) -> Color:
	return ThemeBuilder.WARN if warn else (ThemeBuilder.SUCCESS if ok else ThemeBuilder.ERROR)


## WO-919 F26: the state's `osLayout` (os-layout-issue.js) — "" when the OS layout is fine / unknown, else the toolbar
## line. The watchdog gave up re-applying xrandr after a node restart; Apply Caspar config re-applies the layout.
static func os_layout_warning(issue: Variant) -> String:
	if not issue is Dictionary or issue.get("ok") != false:
		return ""
	var parts: Array = []
	var list: Array = issue.get("mismatches", []) if issue.get("mismatches") is Array else []
	for m in list.slice(0, 2):
		if m is Dictionary:
			parts.append("%s %s: want %s, has %s" % [str(m.get("sysId", "?")), str(m.get("field", "?")), str(m.get("expected", "?")), str(m.get("actual", "—"))])
	if list.size() > 2:
		parts.append("+%d more" % (list.size() - 2))
	return "Display layout is still wrong after the restart%s - press Apply Caspar config to re-apply it." % ((" (" + "; ".join(parts) + ")") if not parts.is_empty() else "")
