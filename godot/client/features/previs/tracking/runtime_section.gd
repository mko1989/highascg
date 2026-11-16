extends VBoxContainer
## WO-1094 — the person-detection runtime block at the top of the Detect page: is detection installed on THIS machine
## (GET /api/tracking/runtime), and Install / Install from folder / Repair / Export to folder / Remove / Resume / Cancel
## as one server-side background job (tools/tracking-detect/install.sh) with its progress. A fresh ISO install never has
## detection (the weights are not ours to distribute), so this is how a machine gets it. Words: runtime_model.gd.

const R := preload("res://features/previs/tracking/runtime_model.gd")
const STATUS := "/api/tracking/runtime"
## dev: --runtime-prefix=<abs path> points the block at a scratch runtime (box checks; the server refuses unsafe paths)
var _prefix := str(Config.args.get("runtime-prefix", ""))

signal changed(status: Dictionary)  # a new full status (the Detect page re-reads its model list, gates the master)

var st := {}
var _head: Label
var _detail: Label
var _feats: Label
var _job: Label
var _bar: ProgressBar
var _log: Label
var _buttons := {}
var _install_dlg: ConfirmationDialog
var _install_title: Label
var _checks := {}
var _install_note: Label
var _folder_dlg: ConfirmationDialog
var _folder_pick: OptionButton
var _folder_path: LineEdit
var _folder_note: Label
var _folder_mode := "export"
var _remove_dlg: ConfirmationDialog
var _keep_models: CheckBox
var _poll: Timer
var _loading := false

const LABELS := {"install": "Install…", "import": "Install from folder…", "repair": "Repair", "export": "Export to folder…",
	"remove": "Remove…", "resume": "Resume", "cancel": "Cancel"}


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_head = _label(self)
	_detail = _label(self)
	_detail.modulate = Color(1, 1, 1, 0.8)
	_feats = _label(self)
	_feats.modulate = Color(1, 1, 1, 0.7)
	_job = _label(self)
	_bar = ProgressBar.new()
	_bar.custom_minimum_size.y = 14
	_bar.show_percentage = false
	add_child(_bar)
	_log = _label(self)
	_log.modulate = Color(1, 1, 1, 0.55)
	_log.clip_text = true
	_log.autowrap_mode = TextServer.AUTOWRAP_OFF
	var row := HFlowContainer.new()
	add_child(row)
	for k in LABELS:
		var b := Button.new()
		b.text = LABELS[k]
		b.pressed.connect(_on_action.bind(k))
		row.add_child(b)
		_buttons[k] = b
	_build_install_dialog()
	_build_folder_dialog()
	_build_remove_dialog()
	_poll = Timer.new()
	_poll.wait_time = 1.0
	_poll.timeout.connect(_on_poll)
	add_child(_poll)
	_render()
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			refresh())
	if is_visible_in_tree():
		refresh()
	if Config.args.has("probe-runtime"):  # dev: --probe-runtime=install|remove|export|import opens that dialog (box checks, no pointer)
		get_tree().create_timer(4.0).timeout.connect(_on_action.bind(str(Config.args["probe-runtime"])))


## Full status (with the internet check while detection is not installed).
func refresh() -> void:
	if _loading:
		return
	_loading = true
	var r: Dictionary = await Api.get_json(_url("", "net=1" if not R.usable(st) else ""))
	_loading = false
	if r.ok and r.data is Dictionary:
		st = r.data
		if not R.usable(st) and not st.has("internet"):
			var n: Dictionary = await Api.get_json(_url("", "net=1"))
			if n.ok and n.data is Dictionary:
				st = n.data
		changed.emit(st)
	elif st.is_empty():
		st = {"verdict": "unknown", "reason": str(r.error)}
	_render()


## The Detect master asked to start with no runtime: say so and open the install dialog.
func offer_install() -> void:
	_open_install("Person detection is not installed on this machine. Install it now?")


func _render() -> void:
	if _head == null:
		return
	_head.text = R.headline(st)
	_detail.text = R.detail(st)
	_detail.visible = _detail.text != ""
	_feats.text = R.features_line(st) if R.usable(st) else ""
	_feats.visible = _feats.text != ""
	var j: Variant = st.get("job")
	_job.text = R.job_line(j)
	_job.visible = _job.text != ""
	var run := R.running(st)
	_bar.visible = run
	if run and j is Dictionary and j.get("percent") != null:
		_bar.value = float(j.percent)
	_log.text = R.last_log(j) if run else ""
	_log.visible = run
	var acts := R.actions(st)
	for k in _buttons:
		(_buttons[k] as Button).visible = acts.has(k)
	if run and _poll.is_stopped():
		_poll.start()
	elif not run and not _poll.is_stopped():
		_poll.stop()


func _on_poll() -> void:
	var r: Dictionary = await Api.get_json(_url("", "only=job"))
	if not (r.ok and r.data is Dictionary):
		return
	st["job"] = r.data.get("job")
	if not R.running(st):
		_poll.stop()
		refresh()  # the job ended: the verdict changed
	else:
		_render()


func _on_action(k: String) -> void:
	match k:
		"install":
			_open_install("Install person detection on this machine")
		"import":
			_open_folder("import")
		"export":
			_open_folder("export")
		"repair":
			_start("/api/tracking/runtime/repair", {})
		"remove":
			_popup(_remove_dlg)
		"resume":
			_start("/api/tracking/runtime/resume", {})
		"cancel":
			_start("/api/tracking/runtime/cancel", {})


func _start(path: String, body: Dictionary) -> void:
	if _prefix != "":
		body["prefix"] = _prefix
	var r: Dictionary = await Api.post_json(path, body)
	if not r.ok:
		var msg := str(r.error)
		if r.data is Dictionary and str(r.data.get("error", "")) != "":
			msg = str(r.data.error)
		_job.text = "Could not start: %s" % msg
		_job.visible = true
		return
	if r.data is Dictionary and r.data.get("job") is Dictionary:
		st["job"] = r.data.job
	_render()


func _build_install_dialog() -> void:
	_install_dlg = ConfirmationDialog.new()
	_install_dlg.title = "Install person detection"
	_install_dlg.ok_button_text = "Install"
	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(520, 0)
	_install_title = _label(box)
	var lic := _label(box)
	lic.text = R.LICENSE_TEXT
	var links := LineEdit.new()  # selectable, copyable
	links.text = R.LICENSE_LINKS
	links.editable = false
	box.add_child(links)
	for c in R.choices({}):
		var cb := CheckBox.new()
		box.add_child(cb)
		_checks[c[0]] = cb
	var face := _label(box)
	face.text = R.FACE_NOTE
	face.modulate = Color(1, 1, 1, 0.7)
	_install_note = _label(box)
	_install_dlg.add_child(box)
	_install_dlg.confirmed.connect(func() -> void:
		var f: Array = []
		for id in _checks:
			if (_checks[id] as CheckBox).button_pressed:
				f.append(id)
		_start("/api/tracking/runtime/install", {"features": f}))
	add_child(_install_dlg)


func _open_install(title: String) -> void:
	_install_title.text = title
	for c in R.choices(st):
		var cb: CheckBox = _checks.get(c[0])
		if cb == null:
			continue
		cb.text = c[1]
		cb.button_pressed = c[2]
		cb.disabled = c[3]
	_install_note.text = R.detail(st) if R.verdict(st) != "ready" else "Already installed parts are kept; only what is missing is downloaded."
	_popup(_install_dlg)
	if not st.has("internet"):
		refresh()


func _build_folder_dialog() -> void:
	_folder_dlg = ConfirmationDialog.new()
	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(520, 0)
	_folder_pick = OptionButton.new()
	_folder_pick.item_selected.connect(func(i: int) -> void: _folder_path.text = str(_folder_pick.get_item_metadata(i)))
	box.add_child(_folder_pick)
	_folder_path = LineEdit.new()
	_folder_path.placeholder_text = "/media/…"
	box.add_child(_folder_path)
	_folder_note = _label(box)
	_folder_dlg.add_child(box)
	_folder_dlg.confirmed.connect(func() -> void:
		var p := _folder_path.text.strip_edges()
		if _folder_mode == "export":
			_start("/api/tracking/runtime/export", {"dest": p})
		else:
			_start("/api/tracking/runtime/import", {"from": p, "features": ["person", "pose", "seg", "face"]}))
	add_child(_folder_dlg)


func _open_folder(mode: String) -> void:
	_folder_mode = mode
	_folder_dlg.title = "Export the detection runtime to a folder" if mode == "export" else "Install person detection from a folder"
	_folder_dlg.ok_button_text = "Export" if mode == "export" else "Install"
	_folder_note.text = R.BUNDLE_NOTE if mode == "export" else "Pick a folder made with Export to folder on a machine with the same Python (%s)." % str(st.get("core", {}).get("system_python", "?"))
	_folder_pick.clear()
	_popup(_folder_dlg)
	var r: Dictionary = await Api.get_json(_url("/folders", ""))
	if not (r.ok and r.data is Dictionary):
		return
	if mode == "export":
		for f in r.data.get("folders", []):
			if str(f.get("blocked", "")) == "":
				var free: Variant = f.get("free_mb")
				_folder_pick.add_item("%s — %s free" % [f.get("label", f.path), R.mb(float(free) * 1e6 if free != null else 0.0)])
				_folder_pick.set_item_metadata(_folder_pick.item_count - 1, str(f.path))
	else:
		for b in r.data.get("bundles", []):
			_folder_pick.add_item("%s (Python %s%s)" % [b.path, b.get("python", "?"), "" if b.get("matches", false) else " — does not match"])
			_folder_pick.set_item_metadata(_folder_pick.item_count - 1, str(b.path))
		if _folder_pick.item_count == 0:
			_folder_note.text += "\nNo bundle found on the mounted sticks — type its folder."
	if _folder_pick.item_count > 0:
		_folder_pick.select(0)
		_folder_path.text = str(_folder_pick.get_item_metadata(0))


func _build_remove_dialog() -> void:
	_remove_dlg = ConfirmationDialog.new()
	_remove_dlg.title = "Remove person detection"
	_remove_dlg.ok_button_text = "Remove"
	var box := VBoxContainer.new()
	var l := _label(box)
	l.text = "Delete the detection runtime from this machine (Python packages, downloads)? Detection stops until it is installed again."
	l.custom_minimum_size.x = 420
	_keep_models = CheckBox.new()
	_keep_models.text = "Keep the models"
	box.add_child(_keep_models)
	_remove_dlg.add_child(box)
	_remove_dlg.confirmed.connect(func() -> void: _start("/api/tracking/runtime/remove", {"keep_models": _keep_models.button_pressed}))
	add_child(_remove_dlg)


func _label(parent: Node) -> Label:
	var l := Label.new()
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	parent.add_child(l)
	return l


func _url(sub: String, q: String) -> String:
	var parts: Array[String] = []
	if q != "":
		parts.append(q)
	if _prefix != "":
		parts.append("prefix=" + _prefix.uri_encode())
	return STATUS + sub + ("?" + "&".join(parts) if not parts.is_empty() else "")


## Wrapped labels size the dialog before they know their width (a window-tall dialog, buttons off screen): fit it again
## once laid out.
func _popup(d: ConfirmationDialog) -> void:
	d.popup_centered(Vector2i(600, 0))
	await get_tree().process_frame
	d.reset_size()
	d.move_to_center()
