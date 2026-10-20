extends RefCounted
## WO-608 — USB import (web usb-import-modal.js): pure helpers for usb_import_dialog.gd.

const MEDIA_EXT := ["mp4", "mov", "qt", "mxf", "mkv", "webm", "avi", "m4v", "mpg", "mpeg", "wmv",
	"png", "jpg", "jpeg", "gif", "webp", "bmp", "tga", "svg",
	"wav", "mp3", "aac", "m4a", "flac", "aiff", "ogg", "zip"]
const EMPTY_HINT := "No removable disk detected on the server. Plug in a USB stick, ensure it is mounted (Linux: often under /media/…), turn on Settings → Media / USB → Enable USB import, then press ↻."


static func is_media(name: String) -> bool:
	return name.contains(".") and MEDIA_EXT.has(name.get_extension().to_lower())


static func format_size(n: Variant) -> String:
	var b := float(n) if n is float or n is int else 0.0
	if b <= 0.0:
		return ""
	if b < 1024.0:
		return "%d B" % int(b)
	var kb := b / 1024.0
	if kb < 1024.0:
		return "%.1f KB" % kb
	var mb := kb / 1024.0
	if mb < 1024.0:
		return "%.1f MB" % mb
	return "%.2f GB" % (mb / 1024.0)


static func drive_label(d: Dictionary) -> String:
	var size := str(d.get("size", "")) if d.get("size") != null and str(d.get("size", "")) != "" else "—"
	return "%s (%s)" % [str(d.get("label", d.get("id", "?"))), size]


static func parent_rel(rel: String) -> String:
	var parts := rel.split("/", false)
	if parts.is_empty():
		return ""
	parts.remove_at(parts.size() - 1)
	return "/".join(parts)


## Breadcrumb [[text, rel]…] from the drive root ("/", "") down to `rel`.
static func crumbs(rel: String) -> Array:
	var out: Array = [["/", ""]]
	var acc := ""
	for p in rel.split("/", false):
		acc = p if acc == "" else acc + "/" + p
		out.append([p, acc])
	return out


static func summary(n: int) -> String:
	return "%d file(s) selected" % n


## import-status / usb:copy-progress → {show, pct, line, done, error}.
static func progress(st: Dictionary) -> Dictionary:
	var phase := str(st.get("phase", ""))
	var active: bool = st.get("active", false) == true
	var pct := clampf(float(st.progress), 0.0, 100.0) if st.get("progress") is float or st.get("progress") is int else 0.0
	var line := str(st.get("message", "")) if st.get("message") != null else ""
	if st.has("fileTotal") and phase == "copying" and not st.has("message"):  # WS frame: no message
		line = "%s (%d/%d)" % [str(st.get("fileRel", "")), int(st.get("fileIndex", 0)) + 1, int(st.fileTotal)]
	elif str(st.get("fileRel", "")) != "":
		line += " — " + str(st.fileRel)
	var err := str(st.error) if phase == "error" and st.get("error") != null else ""
	return {"show": active or phase in ["copying", "complete", "error"], "pct": pct, "line": line,
		"done": phase == "complete" and not active, "error": err}
