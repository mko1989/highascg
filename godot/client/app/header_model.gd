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
		return {"text": why if why != "" else "This project changes the CasparCG channel layout — Apply Caspar config and restart CasparCG.", "tone": "error", "sticky": false}
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


## Godot has no project-name slug rule of its own — the server's (project-store.js projectSlugFromName) decides;
## the client only refuses an empty name.
static func clean_name(text: String) -> String:
	return text.strip_edges()
