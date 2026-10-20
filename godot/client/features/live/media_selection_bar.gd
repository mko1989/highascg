extends VBoxContainer
## WO-603 slice 2 — the web media selection bar (sources-panel-shell.js `sources-media-selection-bar`): "N selected ·
## Rename… (slice 3, media_rename_dialog.gd) · Copy to… · Move to… · HAP… (slice 4: media_hap_dialog.gd, job line +
## Cancel HAP from `media:hap-encode`) · Delete · Clear", plus the "+" menu (slice 8, media_add_menu.gd; New folder… goes
## under the selected folder). Every action is one server
## call (media_ops.gd); the folder picker lists the on-disk folders and takes a typed new path.

signal changed  # the library changed on disk → the panel reloads
signal clear_requested

const AddMenu := preload("res://features/live/media_add_menu.gd")
const Ops := preload("res://features/live/media_ops.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const RenameDialog := preload("res://features/live/media_rename_dialog.gd")
const HapDialog := preload("res://features/live/media_hap_dialog.gd")
const Hap := preload("res://features/live/hap_status.gd")

var ids: Array = []  # selected media ids (files)
var add_menu: AddMenu  # the media panel ingests what it picks
var folder := ""  # the selected folder row ("" = root): New folder… goes under it
var rows: Array = []  # GET /api/media (for the picker)
var before_delete: Callable  # stops a running preview of a file about to go
var _bar: HFlowContainer
var _count: Label
var status: Label
var _hap_cancel: Button
var _jobs := {}  # jobId → the server's job snapshot (media:hap-encode / GET /api/media/hap-encode)
var _announced := {}


func _ready() -> void:
	add_theme_constant_override("separation", 2)
	_bar = HFlowContainer.new()
	_count = Label.new()
	_count.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_bar.add_child(_count)
	_bar.add_child(_button("Rename…", _rename, "Rename the selected files — keeps their numbering; looks, playlists and timelines follow"))
	_bar.add_child(_button("Copy to…", func() -> void: _pick("copy")))
	_bar.add_child(_button("Move to…", func() -> void: _pick("move")))
	_bar.add_child(_button("HAP…", _hap, "Encode the selected clips to HAP (light-CPU playback codec), saved next to the original as _HAP.mov"))
	_bar.add_child(_button("Delete", _confirm_delete))
	_bar.add_child(_button("✕", clear_requested.emit, "Clear the selection"))
	add_child(_bar)
	status = Label.new()  # its own full-width line: the HAP progress must not be clipped by the buttons
	status.clip_text = true
	status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(status)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_END
	_hap_cancel = _button("Cancel HAP", _cancel_hap, "Cancel the running HAP encode")
	_hap_cancel.visible = false
	row.add_child(_hap_cancel)
	add_menu = AddMenu.new()  # web "+" dropup: Select file(s)… · New folder… · Download from URL…
	add_menu.new_folder_requested.connect(_new_folder)
	row.add_child(add_menu)
	add_child(row)
	_say("")
	set_selection([], "")
	Ws.message.connect(func(type: String, data: Variant) -> void:
		if type == "media:hap-encode" and data is Dictionary:
			_on_job(data))
	_attach_hap()


func set_selection(sel: Array, at_folder: String) -> void:
	ids = sel
	folder = at_folder
	_bar.visible = not ids.is_empty()
	_count.text = "%d selected" % ids.size()


func _button(text: String, cb: Callable, tip := "") -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.pressed.connect(cb)
	return b


func _say(text: String) -> void:
	status.visible = text != ""
	status.text = text
	status.tooltip_text = text


func _pick(op: String) -> void:
	var sel := ids.duplicate()
	var verb := "Copy" if op == "copy" else "Move"
	var dlg := ConfirmationDialog.new()
	dlg.title = "%s %s to" % [verb, Ops.plural(sel.size())]
	dlg.ok_button_text = verb
	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(420, 360)
	var tree := Tree.new()
	tree.size_flags_vertical = Control.SIZE_EXPAND_FILL
	tree.hide_root = false
	var path := LineEdit.new()
	path.placeholder_text = "Folder (a new path is created)"
	path.text = folder
	var root := tree.create_item()
	root.set_text(0, "/ (media root)")
	root.set_metadata(0, "")
	var items := {"": root}
	for f in Ops.folders(rows):
		var cut := f.rfind("/")
		var parent: TreeItem = items.get(f.substr(0, cut) if cut > 0 else "", root)
		var it := tree.create_item(parent)
		it.set_text(0, f.get_file())
		it.set_metadata(0, f)
		it.collapsed = not folder.begins_with(f)
		items[f] = it
	tree.item_selected.connect(func() -> void: path.text = str(tree.get_selected().get_metadata(0)))
	box.add_child(tree)
	box.add_child(path)
	dlg.add_child(box)
	dlg.confirmed.connect(func() -> void:
		dlg.queue_free()
		transfer(op, sel, path.text))
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()


## Copy / move `sel` into `target` (the picker, or files dropped on a folder row) and report like the web.
func transfer(op: String, sel: Array, target: String) -> void:
	_say("%s %s…" % ["Copying" if op == "copy" else "Moving", Ops.plural(sel.size())])
	var res: Dictionary = await Api.post_json("/api/media/%s" % op, Ops.transfer_body(sel, target))
	_say(Ops.result_text("Copied" if op == "copy" else "Moved", sel.size(), res))
	if op == "move" and res.ok:
		clear_requested.emit()
	changed.emit()


func _rename() -> void:
	var dlg := RenameDialog.new(ids.duplicate())
	dlg.files_renamed.connect(func(n: int) -> void:
		_say("✓ Renamed %s — looks follow" % Ops.plural(n))
		clear_requested.emit()
		changed.emit())
	add_child(dlg)
	dlg.popup_centered()


func _hap() -> void:
	var sel := ids.duplicate()
	var dlg := HapDialog.new(sel)
	dlg.encode.connect(func(alpha: bool, hq: bool) -> void:
		_say("Queueing %s for HAP…" % Ops.plural(sel.size()))
		var res: Dictionary = await Api.post_json("/api/media/hap-encode", {"ids": sel, "alpha": alpha, "hq": hq})
		if res.ok and res.data is Dictionary:
			_on_job(res.data)
		else:
			_say("✗ HAP encode failed to start: %s" % res.error))
	add_child(dlg)
	dlg.popup_centered()


## A relaunched client re-attaches to whatever is still encoding; finished jobs are not re-announced (web attach()).
func _attach_hap() -> void:
	var res: Dictionary = await Api.get_json("/api/media/hap-encode")
	if not res.ok or not (res.data is Dictionary):
		return
	for j in res.data.get("jobs", []):
		if j is Dictionary and j.has("jobId"):
			if not Hap.job_active(j):
				_announced[j.jobId] = true
			_jobs[j.jobId] = j
	_render_hap()


func _on_job(job: Dictionary) -> void:
	if not job.has("jobId"):
		return
	_jobs[job.jobId] = job
	if not Hap.job_active(job) and not _announced.has(job.jobId):
		_announced[job.jobId] = true
		var sum := Hap.finished_summary(job)
		_say(("✓ " if sum.kind == "ok" else ("✗ " if sum.kind == "error" else "")) + str(sum.text))
		if int((job.get("counts", {}) as Dictionary).get("done", 0)) > 0:
			changed.emit()
	_render_hap()


func _render_hap() -> void:
	var line := Hap.progress_text(_jobs.values())
	_hap_cancel.visible = line != ""
	if line != "":
		_say(line)


func _cancel_hap() -> void:
	for j in _jobs.values():
		if Hap.job_active(j):
			Api.post_json("/api/media/hap-encode/cancel", {"jobId": j.jobId})


func _confirm_delete() -> void:
	var sel := ids.duplicate()
	var dlg := ConfirmationDialog.new()
	dlg.title = "Delete permanently?"
	dlg.ok_button_text = "Delete"
	dlg.dialog_text = "Delete %s permanently?\n\nThis is final — looks, playlists and timelines using them will show them as missing." % Ops.plural(sel.size())
	dlg.confirmed.connect(func() -> void:
		dlg.queue_free()
		if before_delete.is_valid():
			await before_delete.call(sel)
		_say("Deleting %s…" % Ops.plural(sel.size()))
		var res: Dictionary = await Api.post_json("/api/media/delete", Ops.delete_body(sel))
		_say(Ops.result_text("Deleted", sel.size(), res))
		clear_requested.emit()
		changed.emit())
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()


func _new_folder() -> void:
	var base := folder
	var dlg := ConfirmationDialog.new()
	dlg.title = "New folder under %s" % (base + "/" if base != "" else "the media root")
	dlg.ok_button_text = "Create"
	var field := LineEdit.new()
	field.placeholder_text = "Folder name"
	field.custom_minimum_size = Vector2(320, 0)
	dlg.add_child(field)
	dlg.register_text_enter(field)
	dlg.confirmed.connect(func() -> void:
		dlg.queue_free()
		var p := Ops.join_folder(base, field.text)
		if p == Ops.clean_folder(base):
			return
		var res: Dictionary = await Api.post_json("/api/media/mkdir", {"path": p})
		_say(("✓ Created %s" % p) if res.ok else ("✗ New folder failed: %s" % res.error))
		changed.emit())
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()
	field.grab_focus.call_deferred()
