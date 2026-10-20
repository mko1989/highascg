extends RefCounted
## WO-603 slice 1 — desktop drops on the on-box client: `Window.files_dropped` gives local paths, the server copies
## them (POST /api/media/ingest-local {paths, folder}; folders walked server side) and reports over WS
## `media:ingest-progress`. Pure helpers; media_panel.gd owns the wiring.

const EVENT := "media:ingest-progress"


## The folder a drop on a tree item targets: a folder row is itself, a file row its parent folder, nothing → "" (the
## server's default: the active project's media folder, else the root).
static func folder_for(meta: Variant) -> String:
	if not (meta is Dictionary):
		return ""
	if (meta as Dictionary).has("folder"):
		return str(meta.folder)
	var id := str((meta as Dictionary).get("value", "")) if str(meta.get("type", "")) == "media" else ""
	var cut := id.rfind("/")
	return id.substr(0, cut) if cut > 0 else ""


static func request(paths: PackedStringArray, folder: String) -> Dictionary:
	return {"paths": Array(paths), "folder": folder}


## One status line for a progress / result state, "" when there is nothing to show.
static func status_text(st: Dictionary) -> String:
	match str(st.get("phase", "")):
		"copying":
			var total := float(st.get("bytesTotal", 0))
			var pct := int(round(100.0 * float(st.get("bytesDone", 0)) / total)) if total > 0.0 else 0
			var n := int(st.get("fileTotal", 0))
			var i := mini(int(st.get("fileIndex", 0)) + 1, n)
			var rel := str(st.get("fileRel", ""))
			return "Copying %d/%d · %d%%%s" % [i, n, pct, ("  " + rel.get_file()) if rel != "" else ""]
		"complete":
			return "✓ " + str(st.get("message", "Imported"))
		"error", "cancelled":
			return "✗ %s%s" % [st.get("message", "Ingest failed"), (": " + str(st.error)) if str(st.get("error", "")) not in ["", "Cancelled"] else ""]
	return ""


static func busy(st: Dictionary) -> bool:
	return bool(st.get("active", false))
