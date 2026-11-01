extends RefCounted
## WO-608 header — pure helpers for app/header_project.gd (web header-bar.js + load-project-modal.js), testable
## without autoloads.

## The notice line next to New project (web .header-autosave-indicator). `kind`: saved | autosaved | failed | gone |
## info. Returns {text, tone: ok|muted|error, sticky}; a "gone" project stays up (WO-311: autosave has stopped and
## will not retry, the operator must act).
static func notice(kind: String, detail: String, hhmm: String) -> Dictionary:
	match kind:
		"autosaved":
			return {"text": "Autosaved at " + hhmm, "tone": "muted", "sticky": false}
		"saved":
			return {"text": "Saved at " + hhmm, "tone": "ok", "sticky": false}
		"failed":
			return {"text": "Autosave failed: " + (detail if detail != "" else "unknown error"), "tone": "error", "sticky": false}
		"gone":
			return {"text": "Project deleted on server — Save to keep your copy", "tone": "error", "sticky": true}
		"error":
			return {"text": detail, "tone": "error", "sticky": false}
	return {"text": detail, "tone": "ok", "sticky": false}


## WO-919 N1: the notice line is NOTICE_MIN_W wide when idle, grows to fit its text, and never takes more than
## NOTICE_MAX_SHARE of the window (past that the text is elided; the tooltip has all of it).
const NOTICE_MIN_W := 200.0
const NOTICE_MAX_SHARE := 0.45


## `room`: what the header row leaves free — the notice must never push the row past the window (a show with timer
## toggles and a clip on air left no 45% to take: the whole client spilled past the right edge).
static func notice_width(text_w: float, window_w: float, room := INF) -> float:
	return clampf(text_w + 6.0, NOTICE_MIN_W, maxf(NOTICE_MIN_W, minf(window_w * NOTICE_MAX_SHARE, room)))


static func hhmm(t: Dictionary) -> String:
	return "%02d:%02d" % [int(t.get("hour", 0)), int(t.get("minute", 0))]


static func clock_text(t: Dictionary) -> String:
	return "%02d:%02d:%02d" % [int(t.get("hour", 0)), int(t.get("minute", 0)), int(t.get("second", 0))]


## GET /api/project/list → rows for the Load dialog: [{slug, name, saved, active}], server order.
static func project_rows(data: Variant) -> Array:
	var out: Array = []
	if not (data is Dictionary) or not ((data as Dictionary).get("projects") is Array):
		return out
	for p in (data as Dictionary)["projects"]:
		if not (p is Dictionary) or str(p.get("slug", "")) == "":
			continue
		var name := str(p.get("name", "")) if str(p.get("name", "")) != "" else str(p["slug"])
		out.append({"slug": str(p["slug"]), "name": name, "saved": saved_label(str(p.get("savedAt", ""))), "active": p.get("active") == true})
	return out


## WO-697: show "USB stick…" in the Load dialog — a HighAsCG stick is plugged in that this box did not boot from (the
## box syncs with its boot stick on its own; any other stick is saved to / loaded from by hand).
static func offers_stick(list_data: Variant) -> bool:
	if not (list_data is Dictionary) or not ((list_data as Dictionary).get("volumes") is Dictionary):
		return false
	var usb: Variant = list_data.volumes.get("usb")
	return usb is Dictionary and usb.get("mounted") == true and usb.get("bootStick") != true


## GET /api/system/stick → rows for the stick dialog: [{slug, name, saved, on_box}], server order (newest first).
static func stick_rows(data: Variant) -> Array:
	var out: Array = []
	if not (data is Dictionary) or not ((data as Dictionary).get("projects") is Array):
		return out
	for p in (data as Dictionary)["projects"]:
		if p is Dictionary and str(p.get("slug", "")) != "":
			var name := str(p.get("name", "")) if str(p.get("name", "")) != "" else str(p.slug)
			out.append({"slug": str(p.slug), "name": name, "saved": saved_label(str(p.get("savedAt", ""))), "on_box": p.get("onBox") == true})
	return out


## "2026-10-20T20:18:19.789Z" → "2026-10-20 20:18" (UTC → local via the system bias).
static func saved_label(iso: String) -> String:
	if iso.length() < 16:
		return iso
	var unix := Time.get_unix_time_from_datetime_string(iso.substr(0, 19))
	var local := Time.get_datetime_dict_from_unix_time(unix + Time.get_time_zone_from_system().get("bias", 0) * 60)
	return "%04d-%02d-%02d %02d:%02d" % [local.year, local.month, local.day, local.hour, local.minute]


## POST /api/project/load replies with the project plus bookkeeping keys the show document must not keep.
static func loaded_project(data: Variant) -> Dictionary:
	if not (data is Dictionary):
		return {}
	var p: Dictionary = (data as Dictionary).duplicate()
	p.erase("_activation")
	p.erase("_recoveredFromAutosave")
	return p


## What to say after a load (web finishImport toasts): recovered autosave, Caspar layout needing a restart.
static func load_notice(data: Variant) -> Dictionary:
	var d: Dictionary = data if data is Dictionary else {}
	var act: Dictionary = d.get("_activation", {}) if d.get("_activation") is Dictionary else {}
	if act.get("restartRequired") == true:
		var why := str(act.get("restartReason", ""))
		return {"text": why if why != "" else "This project changes the CasparCG channel layout — Apply Caspar config and restart CasparCG.", "tone": "error", "sticky": true, "restart": true}  # WO-918 F1: owed — never fades
	if d.get("_recoveredFromAutosave") == true:
		return {"text": "Project loaded — recovered newer autosaved work", "tone": "ok", "sticky": false}
	return {"text": "Project loaded", "tone": "ok", "sticky": false}


## A picked .json file → the project document, or why not.
static func parse_project_file(text: String) -> Dictionary:
	var v: Variant = JSON.parse_string(text)
	if not (v is Dictionary):
		return {"error": "Invalid project file: not a JSON object"}
	if str((v as Dictionary).get("name", "")).strip_edges() == "":
		(v as Dictionary)["name"] = "Untitled"
	return {"project": v}


## POST /api/project/save body for "Load from file" (WO-823). `keepPayloadHardware` makes the server store the file's
## OWN hardwareConfig; without it the save stamps this box's live rig over it and the following applyHardware load
## would apply the wrong rig. Only the import path sends it: a normal save must keep the hardware hold (WO-821).
static func file_import_body(project: Dictionary) -> Dictionary:
	return {"project": project, "allowReplace": true, "keepPayloadHardware": true}


## WO-918 F1: a successful Apply (routes-caspar-config.js broadcasts change caspar.applied) clears the sticky
## "Apply the CasparCG config" notice a restart-required load left up.
static func answers_restart_notice(d: Variant) -> bool:
	return d is Dictionary and str((d as Dictionary).get("path", "")) == "caspar.applied"


## WO-918 F23: the server refused the file because its stored show of that name has newer work.
static func is_older_file(data: Dictionary) -> bool:
	return str(data.get("reason", "")) in ["stale_rev", "stale_saved_at"]


static func older_file_text(project_name: String) -> String:
	return ("The server already has \"%s\" with newer work than this file.\n\nReplace it with the file (the server's " +
		"version is kept in the project trash), or import the file as a separate copy?") % project_name


## The file's show under a free-standing name: "<name> (copy)", without the stored show's rev / slug.
static func copy_of(project: Dictionary) -> Dictionary:
	var p := project.duplicate(true)
	p["name"] = str(project.get("name", "Project")) + " (copy)"
	p.erase("rev")
	p.erase("slug")
	return p


## Godot has no project-name slug rule of its own — the server's (project-store.js projectSlugFromName) decides;
## the client only refuses an empty name.
static func clean_name(text: String) -> String:
	return text.strip_edges()
