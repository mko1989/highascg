extends VBoxContainer
## WO-825 — Settings → GDTF library: the box-local GDTF Share library (src/fixtures/gdtf-library.js). "Build" fetches the
## description + a small thumbnail of every fixture (≈ 70 MB; the box's own GDTF Share account — GDTF Share's terms do not
## allow shipping the files). A fixture used in a project gets its 3D models fetched on its own; "Download full model
## library" fetches everything up front (≈ 12 GB) for offline venues. Progress polls GET /api/fixtures/library/status.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const Kit := preload("res://features/settings/pane_kit.gd")
const M := preload("res://features/settings/library_model.gd")
const STATUS := "/api/fixtures/library/status"

var _lib: Label
var _job: Label
var _full: Label
var _pending: Label
var _build: Button
var _download: Button
var _cancel: Button
var _delete: Button
var _st := {}
var _busy := false


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	Kit.heading(self, "GDTF library")
	Kit.note(self, "Every GDTF Share fixture with its description and a small thumbnail, kept on this box so any fixture can "
		+ "be patched offline. A fixture's 3D models are fetched when it is used in a project (the generic body shows until "
		+ "then, or while the box is offline).")
	_lib = Kit.note(self, "Loading…")
	_build = Kit.button(self, "Build / update library", _on_build)
	Kit.heading(self, "Full model library")
	Kit.note(self, "For venues without internet: download the 3D models and gobo images of all fixtures now (about 12 GB). "
		+ "Stop it any time; the next start continues.")
	_full = Kit.note(self, "")
	var row := Kit.row(self)
	_download = Kit.button(row, "Download full model library", _on_download)
	_delete = Kit.button(row, "Delete downloaded models", _on_delete)
	_cancel = Kit.button(self, "Stop", _on_cancel)
	_job = Kit.note(self, "")
	_job.add_theme_color_override("font_color", ThemeBuilder.TEXT)
	_pending = Kit.note(self, "")
	var t := Timer.new()
	t.wait_time = 1.5
	t.timeout.connect(func() -> void:
		if is_visible_in_tree() and (M.running(_st) or _st.is_empty()):
			refresh())
	add_child(t)
	t.start()
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			refresh())


func refresh() -> void:
	var r: Dictionary = await Api.get_json(STATUS)
	if not r.ok or not (r.data is Dictionary):
		_lib.text = "Status unavailable: %s" % str(r.error)
		return
	_st = r.data
	var run := M.running(_st)
	_lib.text = M.library_line(_st)
	_full.text = M.full_line(_st)
	_job.text = M.job_line(_st)
	_pending.text = M.pending_line(_st)
	var has_account: bool = _st.get("account") == true
	_build.disabled = run or not has_account
	_download.disabled = run or not has_account
	_delete.disabled = run
	_cancel.visible = run
	_build.tooltip_text = "" if has_account else "No GDTF Share account set on this box"


func _on_build() -> void:
	await _start("/api/fixtures/library/build", {})


func _on_download() -> void:
	Kit.confirm(self, M.confirm_full(_st), func() -> void: await _start("/api/fixtures/library/full", {}))


func _on_cancel() -> void:
	_cancel.disabled = true
	await Api.post_json("/api/fixtures/library/cancel", {})
	_cancel.disabled = false
	await refresh()


func _on_delete() -> void:
	Kit.confirm(self, "Delete the downloaded 3D models and gobo images? The library and fixtures already used in projects stay.",
		func() -> void:
			var r: Dictionary = await Api.delete_json("/api/fixtures/library/full")
			_job.text = ("Freed %s." % M.size((r.data as Dictionary).get("freed", 0))) if r.ok and r.data is Dictionary else str(r.error)
			await refresh())


func _start(path: String, body: Dictionary) -> void:
	var r: Dictionary = await Api.post_json(path, body)
	if not r.ok:
		var d: Dictionary = r.data if r.data is Dictionary else {}
		_job.text = str(d.get("error", r.error))
		return
	await refresh()
