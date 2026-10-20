extends RefCounted
## WO-605 slice 8 — the device snapshot dialogs' request sequences (web device-view-snapshot-modals.js), over an
## injected io shared by the dialogs and the golden replay:
##   io.get_json(path) / io.post_json(path, body) → {ok, data, error}   io.status(text, ok)   io.confirm(text) → bool
##   io.capture() → the rear-panel visual {mimeType, encoding, width, height, data} or null
##   io.download(file_name, text) → the written file's name, "" when the operator cancelled the file dialog
##   io.applied()  (settings + device view re-read — the web's highascg-settings-applied + onApplied)
## Save: true = done (the dialog closes). Load keeps its state here: the parsed file, the preview text, whether Apply
## is enabled.

const M := preload("res://features/devices/snapshot_model.gd")

var io: Variant
var clock: Callable = func() -> float: return Time.get_unix_time_from_system() * 1000.0
var parsed: Variant = null  # the picked file's JSON (null = none / invalid)
var preview := M.PICK
var can_apply := false


func _init(io_: Variant) -> void:
	io = io_


func save(device_name: String, capture: bool) -> bool:
	var name := device_name.strip_edges()
	if name == "":
		io.status(M.NO_NAME, false)
		return false
	var r: Dictionary = await io.get_json("/api/device-snapshot/build")
	var err := str(r.error) if not r.ok else M.envelope_error(r.data)
	if err != "":
		io.status("Save failed: " + err, false)
		return false
	var visual: Variant = null
	if capture:
		visual = io.capture()
		if visual == null:
			io.status(M.NO_IMAGE, false)
	var doc := M.document(r.data, name, visual, clock.call())
	var written: String = await io.download("%s.json" % doc.slug, M.to_text(doc))
	if written == "":
		return false
	io.status("Saved " + written, true)
	return true


## A file was picked (text) or the pick came back empty (null).
func on_file(text: Variant) -> void:
	parsed = null
	can_apply = false
	if text == null:
		preview = M.NO_FILE
		return
	var p := M.parse_file(str(text))
	if p.ok:
		parsed = p.data
		preview = M.READY
	else:
		preview = p.error


## Preview = the server's dry run. The web drops the validation `details`; they follow the error here.
func dry_run(mode: String) -> void:
	if parsed == null:
		io.status(M.NO_JSON, false)
		return
	preview = M.CHECKING
	var r: Dictionary = await io.post_json("/api/device-snapshot/apply", {"snapshot": parsed, "mode": _mode(mode), "dryRun": true})
	var data: Dictionary = r.data if r.data is Dictionary else {}
	if r.ok and data.get("ok") is bool and data.ok:
		preview = M.dry_text(data)
		can_apply = true
		return
	preview = "Error: " + (str(r.error) if not r.ok else M._js(data.error) if M._truthy(data.get("error")) else "Validation failed")
	var details: Variant = data.get("details")
	if details is Array and not details.is_empty():
		preview += "\n" + "\n".join(details.map(func(d: Variant) -> String: return "• " + str(d)))
	can_apply = false


## Apply: true = done (the dialog closes).
func apply(mode: String) -> bool:
	if parsed == null or not can_apply:
		return false
	var m := _mode(mode)
	if not await io.confirm(M.apply_confirm(m)):
		return false
	var r: Dictionary = await io.post_json("/api/device-snapshot/apply", {"snapshot": parsed, "mode": m, "dryRun": false})
	var data: Dictionary = r.data if r.data is Dictionary else {}
	if not r.ok or not (data.get("ok") is bool and data.ok):
		var e := str(r.error) if not r.ok else (M._js(data.error) if M._truthy(data.get("error")) else "Apply failed")
		io.status("Apply failed: " + e, false)
		return false
	io.status(M.APPLIED, true)
	io.applied()
	return true


static func _mode(mode: String) -> String:
	return "graphOnly" if mode == "graphOnly" else "full"
